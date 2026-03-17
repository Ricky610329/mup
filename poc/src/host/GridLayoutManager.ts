import type { GridAllocation, GridRequirements, GridState } from "../protocol/types";

export class GridLayoutManager {
  private totalColumns: number;
  private totalRows: number;
  private container: HTMLElement;
  private occupancy: boolean[][];
  private allocations = new Map<string, GridAllocation>();
  private cellSize = 0;
  private gap = 8;

  constructor(container: HTMLElement, columns = 4, rows = 3) {
    this.container = container;
    this.totalColumns = columns;
    this.totalRows = rows;
    this.occupancy = this.createOccupancyGrid();
    this.applyGridCSS();
    this.renderEmptyCells();
    window.addEventListener("resize", () => this.applyGridCSS());
  }

  allocate(mupId: string, requirements: GridRequirements): GridAllocation | null {
    if (this.allocations.has(mupId)) return this.allocations.get(mupId)!;

    if (requirements.minWidth === 0 && requirements.minHeight === 0) {
      const a: GridAllocation = { mupId, x: 0, y: 0, widthSpan: 0, heightSpan: 0 };
      this.allocations.set(mupId, a);
      return a;
    }

    const prefCols = requirements.preferredWidth ?? requirements.minWidth;
    const prefRows = requirements.preferredHeight ?? requirements.minHeight;

    let allocation = this.findSpace(mupId, prefCols, prefRows);
    if (!allocation && (prefCols !== requirements.minWidth || prefRows !== requirements.minHeight)) {
      allocation = this.findSpace(mupId, requirements.minWidth, requirements.minHeight);
    }

    if (allocation) {
      this.allocations.set(mupId, allocation);
      this.markOccupied(allocation);
      this.renderEmptyCells();
    }
    return allocation;
  }

  deallocate(mupId: string): void {
    const alloc = this.allocations.get(mupId);
    if (!alloc) return;
    if (alloc.widthSpan > 0) this.markFree(alloc);
    this.allocations.delete(mupId);
    this.renderEmptyCells();
  }

  getState(): GridState {
    return { totalColumns: this.totalColumns, totalRows: this.totalRows, allocations: Array.from(this.allocations.values()) };
  }

  getAllocation(mupId: string): GridAllocation | undefined {
    return this.allocations.get(mupId);
  }

  getCellSize(): number { return this.cellSize; }
  getGap(): number { return this.gap; }
  getColumns(): number { return this.totalColumns; }
  getRows(): number { return this.totalRows; }

  /** Move a MUP to a new grid position. Returns true if successful. */
  moveMup(mupId: string, newCol: number, newRow: number): boolean {
    const alloc = this.allocations.get(mupId);
    if (!alloc || alloc.widthSpan === 0) return false;

    // Bounds check
    if (newCol < 1 || newRow < 1) return false;
    if (newCol + alloc.widthSpan - 1 > this.totalColumns) return false;
    if (newRow + alloc.heightSpan - 1 > this.totalRows) return false;

    // Temporarily free old space
    this.markFree(alloc);

    // Check if new position is free
    if (!this.isRegionFree(newCol, newRow, alloc.widthSpan, alloc.heightSpan)) {
      this.markOccupied(alloc); // restore
      return false;
    }

    alloc.x = newCol;
    alloc.y = newRow;
    this.markOccupied(alloc);
    this.renderEmptyCells();
    return true;
  }

  /** Resize a MUP to new dimensions. Returns true if successful. */
  resizeMup(mupId: string, newCols: number, newRows: number): boolean {
    const alloc = this.allocations.get(mupId);
    if (!alloc || alloc.widthSpan === 0) return false;

    if (newCols < 1 || newRows < 1) return false;
    if (alloc.x + newCols - 1 > this.totalColumns) return false;
    if (alloc.y + newRows - 1 > this.totalRows) return false;

    this.markFree(alloc);

    if (!this.isRegionFree(alloc.x, alloc.y, newCols, newRows)) {
      this.markOccupied(alloc);
      return false;
    }

    alloc.widthSpan = newCols;
    alloc.heightSpan = newRows;
    this.markOccupied(alloc);
    this.renderEmptyCells();
    return true;
  }

  /** Convert pixel coordinates (relative to container) to grid col/row (1-based) */
  pixelToGrid(px: number, py: number): { col: number; row: number } {
    const cs = this.cellSize;
    const g = this.gap;
    const col = Math.floor(px / (cs + g)) + 1;
    const row = Math.floor(py / (cs + g)) + 1;
    return {
      col: Math.max(1, Math.min(col, this.totalColumns)),
      row: Math.max(1, Math.min(row, this.totalRows)),
    };
  }

  /** Get the container's bounding rect */
  getContainerRect(): DOMRect {
    return this.container.getBoundingClientRect();
  }

  /** Get the actual pixel offset where the grid content starts (accounting for centering) */
  getGridOrigin(): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    const cs = this.cellSize;
    const g = this.gap;
    const totalGridW = this.totalColumns * cs + (this.totalColumns - 1) * g;
    const totalGridH = this.totalRows * cs + (this.totalRows - 1) * g;
    // Center offset
    const offsetX = (rect.width - totalGridW) / 2;
    const offsetY = (rect.height - totalGridH) / 2;
    return { x: rect.left + Math.max(0, offsetX), y: rect.top + Math.max(0, offsetY) };
  }

  resize(columns: number, rows: number): void {
    this.totalColumns = columns;
    this.totalRows = rows;
    this.occupancy = this.createOccupancyGrid();
    for (const alloc of this.allocations.values()) {
      if (alloc.widthSpan > 0) this.markOccupied(alloc);
    }
    this.applyGridCSS();
    this.renderEmptyCells();
  }

  renderEmptyCells(): void {
    this.container.querySelectorAll(".grid-cell-empty").forEach((el) => el.remove());
    for (let r = 0; r < this.totalRows; r++) {
      for (let c = 0; c < this.totalColumns; c++) {
        if (!this.occupancy[r][c]) {
          const cell = document.createElement("div");
          cell.className = "grid-cell-empty";
          cell.style.gridColumn = `${c + 1}`;
          cell.style.gridRow = `${r + 1}`;
          this.container.appendChild(cell);
        }
      }
    }
  }

  private findSpace(mupId: string, cols: number, rows: number): GridAllocation | null {
    for (let r = 1; r <= this.totalRows - rows + 1; r++) {
      for (let c = 1; c <= this.totalColumns - cols + 1; c++) {
        if (this.isRegionFree(c, r, cols, rows)) {
          return { mupId, x: c, y: r, widthSpan: cols, heightSpan: rows };
        }
      }
    }
    return null;
  }

  private isRegionFree(col: number, row: number, cols: number, rows: number): boolean {
    for (let r = row - 1; r < row - 1 + rows; r++) {
      for (let c = col - 1; c < col - 1 + cols; c++) {
        if (r >= this.totalRows || c >= this.totalColumns) return false;
        if (this.occupancy[r][c]) return false;
      }
    }
    return true;
  }

  private markOccupied(alloc: GridAllocation): void {
    for (let r = alloc.y - 1; r < alloc.y - 1 + alloc.heightSpan; r++) {
      for (let c = alloc.x - 1; c < alloc.x - 1 + alloc.widthSpan; c++) {
        if (r < this.totalRows && c < this.totalColumns) this.occupancy[r][c] = true;
      }
    }
  }

  private markFree(alloc: GridAllocation): void {
    for (let r = alloc.y - 1; r < alloc.y - 1 + alloc.heightSpan; r++) {
      for (let c = alloc.x - 1; c < alloc.x - 1 + alloc.widthSpan; c++) {
        if (r < this.totalRows && c < this.totalColumns) this.occupancy[r][c] = false;
      }
    }
  }

  private createOccupancyGrid(): boolean[][] {
    return Array.from({ length: this.totalRows }, () =>
      Array.from({ length: this.totalColumns }, () => false)
    );
  }

  applyGridCSS(): void {
    const g = this.gap;
    this.container.style.display = "grid";
    this.container.style.gap = g + "px";
    this.container.style.height = "100%";
    this.container.style.justifyContent = "center";
    this.container.style.alignContent = "center";

    requestAnimationFrame(() => {
      const cs = getComputedStyle(this.container);
      const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const h = this.container.clientHeight - padV;
      if (h <= 0) return;
      this.cellSize = Math.floor((h - (this.totalRows - 1) * g) / this.totalRows);
      this.container.style.gridTemplateRows = `repeat(${this.totalRows}, ${this.cellSize}px)`;
      this.container.style.gridTemplateColumns = `repeat(${this.totalColumns}, ${this.cellSize}px)`;
    });
  }
}
