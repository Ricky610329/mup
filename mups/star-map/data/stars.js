// Star catalog: ~300 brightest stars
// [name, RA_hours, Dec_degrees, magnitude, constellation_key, spectral_type]
const STARS = [

  // ---- Orion ----
  ["Betelgeuse", 5.92, 7.41, 0.42, "Ori", "M"],
  ["Rigel", 5.24, -8.20, 0.13, "Ori", "B"],
  ["Bellatrix", 5.42, 6.35, 1.64, "Ori", "B"],
  ["Saiph", 5.80, -9.67, 2.09, "Ori", "B"],
  ["Alnitak", 5.68, -1.94, 1.77, "Ori", "B"],
  ["Alnilam", 5.60, -1.20, 1.69, "Ori", "B"],
  ["Mintaka", 5.53, -0.30, 2.23, "Ori", "B"],

  // ---- Ursa Major ----
  ["Dubhe", 11.06, 61.75, 1.79, "UMa", "K"],
  ["Merak", 11.03, 56.38, 2.37, "UMa", "A"],
  ["Phecda", 11.90, 53.69, 2.44, "UMa", "A"],
  ["Megrez", 12.26, 57.03, 3.31, "UMa", "A"],
  ["Alioth", 12.90, 55.96, 1.77, "UMa", "A"],
  ["Mizar", 13.40, 54.93, 2.27, "UMa", "A"],
  ["Alkaid", 13.79, 49.31, 1.86, "UMa", "B"],
  ["Muscida", 8.50, 60.72, 3.35, "UMa", "G"],
  ["Talitha", 9.04, 51.68, 3.14, "UMa", "A"],
  ["Tania Borealis", 10.28, 42.91, 3.45, "UMa", "A"],
  ["Tania Australis", 10.37, 41.50, 3.06, "UMa", "M"],

  // ---- Ursa Minor ----
  ["Polaris", 2.53, 89.26, 2.02, "UMi", "F"],
  ["Kochab", 14.85, 74.16, 2.08, "UMi", "K"],
  ["Pherkad", 15.35, 71.83, 3.05, "UMi", "A"],
  ["Epsilon UMi", 16.77, 82.04, 4.23, "UMi", "G"],
  ["Delta UMi", 17.54, 86.59, 4.36, "UMi", "A"],
  ["Zeta UMi", 15.73, 77.79, 4.32, "UMi", "A"],
  ["Eta UMi", 16.29, 75.76, 4.95, "UMi", "F"],

  // ---- Cassiopeia ----
  ["Schedar", 0.68, 56.54, 2.23, "Cas", "K"],
  ["Caph", 0.15, 59.15, 2.27, "Cas", "F"],
  ["Gamma Cas", 0.95, 60.72, 2.47, "Cas", "B"],
  ["Ruchbah", 1.43, 60.24, 2.68, "Cas", "A"],
  ["Segin", 1.91, 63.67, 3.37, "Cas", "B"],

  // ---- Leo ----
  ["Regulus", 10.14, 11.97, 1.35, "Leo", "B"],
  ["Denebola", 11.82, 14.57, 2.14, "Leo", "A"],
  ["Algieba", 10.33, 19.84, 2.28, "Leo", "K"],
  ["Zosma", 11.24, 20.52, 2.56, "Leo", "A"],
  ["Ras Elased", 9.76, 23.77, 2.98, "Leo", "K"],
  ["Chertan", 11.24, 15.43, 3.33, "Leo", "A"],

  // ---- Scorpius ----
  ["Antares", 16.49, -26.43, 1.09, "Sco", "M"],
  ["Shaula", 17.56, -37.10, 1.63, "Sco", "B"],
  ["Sargas", 17.62, -42.00, 1.87, "Sco", "F"],
  ["Dschubba", 16.01, -22.62, 2.32, "Sco", "B"],
  ["Graffias", 16.09, -19.81, 2.62, "Sco", "B"],
  ["Epsilon Sco", 16.84, -34.29, 2.29, "Sco", "K"],
  ["Zeta Sco", 16.90, -42.36, 3.62, "Sco", "K"],
  ["Eta Sco", 17.20, -43.24, 3.33, "Sco", "F"],
  ["Kappa Sco", 17.71, -39.03, 2.39, "Sco", "B"],
  ["Theta Sco", 17.62, -43.00, 1.87, "Sco", "F"],
  ["Iota1 Sco", 17.79, -40.13, 3.03, "Sco", "F"],
  ["Mu1 Sco", 16.87, -38.05, 3.04, "Sco", "B"],
  ["Pi Sco", 15.98, -26.11, 2.89, "Sco", "B"],

  // ---- Gemini ----
  ["Pollux", 7.76, 28.03, 1.14, "Gem", "K"],
  ["Castor", 7.58, 31.89, 1.58, "Gem", "A"],
  ["Alhena", 6.63, 16.40, 1.93, "Gem", "A"],
  ["Tejat", 6.38, 22.51, 2.88, "Gem", "M"],
  ["Mebsuta", 6.73, 25.13, 3.06, "Gem", "G"],
  ["Wasat", 7.34, 21.98, 3.53, "Gem", "F"],

  // ---- Taurus ----
  ["Aldebaran", 4.60, 16.51, 0.85, "Tau", "K"],
  ["Elnath", 5.44, 28.61, 1.65, "Tau", "B"],
  ["Alcyone", 3.79, 24.11, 2.87, "Tau", "B"],
  ["Zeta Tau", 5.63, 21.14, 3.01, "Tau", "B"],
  ["Lambda Tau", 4.01, 12.49, 3.47, "Tau", "B"],
  ["Epsilon Tau", 4.48, 19.18, 3.53, "Tau", "K"],
  ["Theta2 Tau", 4.48, 15.87, 3.40, "Tau", "A"],

  // ---- Canis Major ----
  ["Sirius", 6.75, -16.72, -1.46, "CMa", "A"],
  ["Adhara", 6.98, -28.97, 1.50, "CMa", "B"],
  ["Wezen", 7.14, -26.39, 1.84, "CMa", "F"],
  ["Mirzam", 6.38, -17.96, 1.98, "CMa", "B"],
  ["Aludra", 7.40, -29.30, 2.45, "CMa", "B"],
  ["Furud", 6.34, -30.06, 3.02, "CMa", "B"],

  // ---- Canis Minor ----
  ["Procyon", 7.65, 5.22, 0.34, "CMi", "F"],
  ["Gomeisa", 7.45, 8.29, 2.89, "CMi", "B"],

  // ---- Cygnus ----
  ["Deneb", 20.69, 45.28, 1.25, "Cyg", "A"],
  ["Sadr", 20.37, 40.26, 2.20, "Cyg", "F"],
  ["Gienah Cyg", 20.77, 33.97, 2.46, "Cyg", "K"],
  ["Delta Cyg", 19.75, 45.13, 2.87, "Cyg", "B"],
  ["Albireo", 19.51, 27.96, 3.08, "Cyg", "K"],

  // ---- Lyra ----
  ["Vega", 18.62, 38.78, 0.03, "Lyr", "A"],
  ["Sheliak", 18.83, 33.36, 3.52, "Lyr", "B"],
  ["Sulafat", 18.98, 32.69, 3.24, "Lyr", "B"],
  ["Delta2 Lyr", 18.91, 36.90, 4.30, "Lyr", "M"],
  ["Zeta Lyr", 18.75, 37.61, 4.37, "Lyr", "A"],

  // ---- Aquila ----
  ["Altair", 19.85, 8.87, 0.77, "Aql", "A"],
  ["Tarazed", 19.77, 10.61, 2.72, "Aql", "K"],
  ["Alshain", 19.92, 6.41, 3.71, "Aql", "G"],
  ["Delta Aql", 19.43, 3.11, 3.36, "Aql", "F"],
  ["Zeta Aql", 19.09, 13.86, 2.99, "Aql", "A"],
  ["Theta Aql", 20.19, -0.82, 3.23, "Aql", "B"],
  ["Lambda Aql", 19.10, -4.88, 3.44, "Aql", "B"],

  // ---- Virgo ----
  ["Spica", 13.42, -11.16, 1.04, "Vir", "B"],
  ["Porrima", 12.69, -1.45, 2.74, "Vir", "F"],
  ["Vindemiatrix", 13.04, 10.96, 2.83, "Vir", "G"],
  ["Auva", 12.93, 3.40, 3.38, "Vir", "M"],
  ["Zavijava", 11.84, 1.76, 3.61, "Vir", "F"],
  ["Heze", 13.58, -0.60, 3.37, "Vir", "A"],
  ["Zaniah", 12.33, -0.67, 3.89, "Vir", "A"],

  // ---- Sagittarius ----
  ["Kaus Australis", 18.40, -34.38, 1.85, "Sgr", "B"],
  ["Nunki", 18.92, -26.30, 2.02, "Sgr", "B"],
  ["Ascella", 19.04, -29.88, 2.59, "Sgr", "A"],
  ["Kaus Media", 18.35, -29.83, 2.70, "Sgr", "K"],
  ["Kaus Borealis", 18.23, -25.42, 2.81, "Sgr", "K"],
  ["Nash", 18.10, -30.42, 2.99, "Sgr", "K"],
  ["Rukbat", 19.40, -40.62, 3.97, "Sgr", "B"],
  ["Phi Sgr", 18.76, -26.99, 3.17, "Sgr", "B"],

  // ---- Andromeda ----
  ["Alpheratz", 0.14, 29.09, 2.06, "And", "B"],
  ["Mirach", 1.16, 35.62, 2.05, "And", "M"],
  ["Almach", 2.07, 42.33, 2.17, "And", "K"],
  ["Delta And", 0.66, 30.86, 3.27, "And", "K"],

  // ---- Perseus ----
  ["Mirfak", 3.41, 49.86, 1.80, "Per", "F"],
  ["Algol", 3.14, 40.96, 2.12, "Per", "B"],
  ["Zeta Per", 3.90, 31.88, 2.85, "Per", "B"],
  ["Epsilon Per", 3.96, 40.01, 2.89, "Per", "B"],
  ["Delta Per", 3.72, 47.79, 3.01, "Per", "B"],
  ["Gamma Per", 3.08, 53.51, 2.93, "Per", "G"],
  ["Eta Per", 2.84, 55.90, 3.76, "Per", "K"],

  // ---- Pegasus ----
  ["Enif", 21.74, 9.88, 2.39, "Peg", "K"],
  ["Scheat", 23.06, 28.08, 2.42, "Peg", "M"],
  ["Markab", 23.08, 15.21, 2.49, "Peg", "B"],
  ["Algenib", 0.22, 15.19, 2.83, "Peg", "B"],
  ["Matar", 22.72, 30.22, 2.94, "Peg", "G"],
  ["Homam", 22.69, 10.83, 3.41, "Peg", "B"],

  // ---- Crux (Southern Cross) ----
  ["Acrux", 12.44, -63.10, 0.76, "Cru", "B"],
  ["Mimosa", 12.80, -59.69, 1.25, "Cru", "B"],
  ["Gacrux", 12.52, -57.11, 1.64, "Cru", "M"],
  ["Delta Cru", 12.25, -58.75, 2.80, "Cru", "B"],

  // ---- Centaurus ----
  ["Rigil Kent", 14.66, -60.83, -0.01, "Cen", "G"],
  ["Hadar", 14.06, -60.37, 0.61, "Cen", "B"],
  ["Menkent", 14.11, -36.37, 2.06, "Cen", "K"],
  ["Epsilon Cen", 13.66, -53.47, 2.30, "Cen", "B"],
  ["Eta Cen", 14.59, -42.16, 2.33, "Cen", "B"],
  ["Gamma Cen", 12.69, -48.96, 2.17, "Cen", "A"],
  ["Iota Cen", 13.34, -36.71, 2.75, "Cen", "A"],

  // ---- Aries ----
  ["Hamal", 2.12, 23.46, 2.00, "Ari", "K"],
  ["Sheratan", 1.91, 20.81, 2.64, "Ari", "A"],
  ["Mesarthim", 1.90, 19.29, 3.88, "Ari", "A"],

  // ---- Pisces ----
  ["Eta Psc", 1.52, 15.35, 3.62, "Psc", "G"],
  ["Gamma Psc", 23.29, 3.28, 3.69, "Psc", "G"],
  ["Omega Psc", 23.99, 6.86, 4.01, "Psc", "F"],
  ["Alpha Psc", 2.03, 2.76, 3.82, "Psc", "A"],

  // ---- Cancer ----
  ["Tarf", 8.28, 9.19, 3.52, "Cnc", "K"],
  ["Acubens", 8.97, 11.86, 4.25, "Cnc", "A"],
  ["Asellus Australis", 8.74, 18.15, 3.94, "Cnc", "K"],
  ["Asellus Borealis", 8.72, 21.47, 4.66, "Cnc", "A"],

  // ---- Libra ----
  ["Zubeneschamali", 15.28, -9.38, 2.61, "Lib", "B"],
  ["Zubenelgenubi", 14.85, -16.04, 2.75, "Lib", "A"],
  ["Sigma Lib", 15.07, -25.28, 3.29, "Lib", "M"],
  ["Upsilon Lib", 15.62, -28.14, 3.58, "Lib", "K"],

  // ---- Bootes ----
  ["Arcturus", 14.26, 19.18, -0.05, "Boo", "K"],
  ["Izar", 14.75, 27.07, 2.37, "Boo", "A"],
  ["Muphrid", 13.91, 18.40, 2.68, "Boo", "G"],
  ["Nekkar", 15.03, 40.39, 3.58, "Boo", "G"],
  ["Seginus", 14.53, 38.31, 3.03, "Boo", "A"],

  // ---- Auriga ----
  ["Capella", 5.28, 46.00, 0.08, "Aur", "G"],
  ["Menkalinan", 5.99, 44.95, 1.90, "Aur", "A"],
  ["Mahasim", 5.99, 37.21, 2.69, "Aur", "A"],
  ["Hassaleh", 4.95, 33.17, 2.69, "Aur", "K"],
  ["Almaaz", 5.03, 43.82, 2.99, "Aur", "F"],

  // ---- Carina ----
  ["Canopus", 6.40, -52.70, -0.74, "Car", "F"],
  ["Avior", 8.38, -59.51, 1.86, "Car", "K"],
  ["Miaplacidus", 9.22, -69.72, 1.68, "Car", "A"],
  ["Tureis", 8.08, -24.30, 2.25, "Car", "F"],
  ["Iota Car", 9.28, -59.28, 2.25, "Car", "A"],

  // ---- Eridanus ----
  ["Achernar", 1.63, -57.24, 0.46, "Eri", "B"],
  ["Cursa", 5.13, -5.09, 2.79, "Eri", "A"],
  ["Zaurak", 3.97, -13.51, 2.95, "Eri", "M"],
  ["Rana", 3.72, -9.76, 3.54, "Eri", "K"],
  ["Epsilon Eri", 3.55, -9.46, 3.73, "Eri", "K"],
  ["Theta1 Eri", 2.97, -40.30, 2.88, "Eri", "A"],

  // ---- Piscis Austrinus ----
  ["Fomalhaut", 22.96, -29.62, 1.16, "PsA", "A"],

  // ---- Ophiuchus ----
  ["Rasalhague", 17.58, 12.56, 2.07, "Oph", "A"],
  ["Sabik", 17.17, -15.72, 2.43, "Oph", "A"],
  ["Yed Prior", 16.31, -3.69, 2.74, "Oph", "M"],
  ["Cebalrai", 17.72, 4.57, 2.77, "Oph", "K"],
  ["Yed Posterior", 16.62, -10.57, 3.24, "Oph", "K"],
  ["Zeta Oph", 16.37, -10.57, 2.56, "Oph", "O"],
  ["Kappa Oph", 16.96, 9.38, 3.20, "Oph", "K"],

  // ---- Serpens ----
  ["Unukalhai", 15.74, 6.43, 2.65, "Ser", "K"],
  ["Eta Ser", 18.35, -2.90, 3.26, "Ser", "K"],
  ["Mu Ser", 15.83, -3.43, 3.54, "Ser", "A"],
  ["Beta Ser", 15.77, 15.42, 3.67, "Ser", "A"],

  // ---- Corona Borealis ----
  ["Alphecca", 15.58, 26.71, 2.23, "CrB", "A"],
  // Nusakan removed (= Beta CrB)
  ["Gamma CrB", 15.71, 26.30, 3.84, "CrB", "A"],

  // ---- Draco ----
  ["Eltanin", 17.94, 51.49, 2.23, "Dra", "K"],
  ["Rastaban", 17.51, 52.30, 2.79, "Dra", "G"],
  ["Thuban", 14.07, 64.38, 3.65, "Dra", "A"],
  ["Eta Dra", 16.40, 61.51, 2.74, "Dra", "G"],
  ["Aldhibah", 17.15, 65.71, 3.17, "Dra", "G"],
  ["Kappa Dra", 12.56, 69.79, 3.87, "Dra", "B"],
  ["Grumium", 17.89, 56.87, 3.75, "Dra", "K"],

  // ---- Cepheus ----
  ["Alderamin", 21.31, 62.59, 2.51, "Cep", "A"],
  ["Errai", 23.66, 77.63, 3.21, "Cep", "K"],
  ["Alfirk", 21.48, 70.56, 3.23, "Cep", "B"],
  ["Zeta Cep", 22.18, 58.20, 3.35, "Cep", "K"],
  ["Iota Cep", 22.83, 66.20, 3.52, "Cep", "K"],

  // ---- Corvus ----
  ["Gienah Crv", 12.26, -17.54, 2.59, "Crv", "B"],
  ["Algorab", 12.50, -16.52, 2.94, "Crv", "A"],
  ["Kraz", 12.17, -22.62, 2.65, "Crv", "G"],
  ["Minkar", 12.10, -22.62, 3.02, "Crv", "K"],
  ["Alchiba", 12.14, -24.73, 4.02, "Crv", "F"],

  // ---- Triangulum ----
  ["Mothallah", 1.88, 29.58, 3.41, "Tri", "F"],
  ["Beta Tri", 2.16, 34.99, 3.00, "Tri", "A"],
  ["Gamma Tri", 2.29, 33.85, 4.01, "Tri", "A"],

  // ---- Lepus ----
  ["Arneb", 5.55, -17.82, 2.58, "Lep", "F"],
  ["Nihal", 5.47, -20.76, 2.84, "Lep", "G"],
  ["Mu Lep", 5.22, -16.21, 3.31, "Lep", "B"],
  ["Epsilon Lep", 5.09, -22.37, 3.19, "Lep", "K"],

  // ---- Columba ----
  ["Phact", 5.66, -34.07, 2.64, "Col", "B"],
  ["Wazn", 5.85, -35.77, 3.12, "Col", "K"],

  // ---- Monoceros ----
  ["Alpha Mon", 7.69, -9.55, 3.93, "Mon", "K"],
  ["Beta Mon", 6.48, -7.03, 3.74, "Mon", "B"],
  ["Gamma Mon", 6.25, -6.27, 3.98, "Mon", "K"],

  // ---- Puppis ----
  ["Naos", 8.06, -40.00, 2.25, "Pup", "O"],
  ["Pi Pup", 7.29, -37.10, 2.71, "Pup", "K"],
  ["Rho Pup", 8.13, -24.30, 2.81, "Pup", "F"],
  ["Tau Pup", 6.83, -50.61, 2.93, "Pup", "K"],
  ["Nu Pup", 6.63, -43.20, 3.17, "Pup", "B"],
  ["Sigma Pup", 7.49, -43.30, 3.25, "Pup", "K"],

  // ---- Vela ----
  ["Suhail", 9.13, -43.43, 2.21, "Vel", "K"],
  ["Gamma Vel", 8.16, -47.34, 1.78, "Vel", "O"],
  ["Delta Vel", 8.75, -54.71, 1.96, "Vel", "A"],
  ["Kappa Vel", 9.37, -55.01, 2.50, "Vel", "B"],
  ["Mu Vel", 10.78, -49.42, 2.69, "Vel", "G"],
  ["Phi Vel", 9.95, -54.57, 3.54, "Vel", "B"],

  // ---- Lupus ----
  ["Alpha Lup", 14.70, -47.39, 2.30, "Lup", "B"],
  ["Beta Lup", 14.98, -43.13, 2.68, "Lup", "B"],
  ["Gamma Lup", 15.59, -41.17, 2.78, "Lup", "B"],
  ["Delta Lup", 15.36, -40.65, 3.22, "Lup", "B"],
  ["Epsilon Lup", 15.38, -44.69, 3.37, "Lup", "B"],

  // ---- Canes Venatici ----
  ["Cor Caroli", 12.93, 38.32, 2.89, "CVn", "A"],
  ["Chara", 12.56, 41.36, 4.24, "CVn", "G"],

  // ---- Hydra ----
  ["Alphard", 9.46, -8.66, 1.98, "Hya", "K"],
  ["Gamma Hya", 13.32, -23.17, 3.00, "Hya", "G"],
  ["Zeta Hya", 8.92, 5.95, 3.11, "Hya", "G"],
  ["Nu Hya", 10.83, -16.19, 3.11, "Hya", "K"],
  ["Pi Hya", 14.11, -26.68, 3.27, "Hya", "K"],
  ["Epsilon Hya", 8.78, 6.42, 3.38, "Hya", "G"],

  // ---- Crater ----
  ["Delta Crt", 11.32, -14.78, 3.56, "Crt", "K"],
  ["Alpha Crt", 10.99, -18.30, 4.08, "Crt", "K"],
  ["Gamma Crt", 11.42, -17.68, 4.08, "Crt", "A"],
  ["Beta Crt", 11.19, -22.83, 4.46, "Crt", "A"],

  // ---- Hercules ----
  ["Kornephoros", 16.50, 21.49, 2.77, "Her", "G"],
  ["Zeta Her", 16.69, 31.60, 2.81, "Her", "G"],
  ["Eta Her", 16.71, 38.92, 3.53, "Her", "G"],
  ["Pi Her", 17.25, 36.81, 3.16, "Her", "K"],
  ["Mu Her", 17.77, 27.72, 3.42, "Her", "G"],
  ["Delta Her", 17.25, 24.84, 3.14, "Her", "A"],
  ["Epsilon Her", 17.00, 30.93, 3.92, "Her", "A"],

  // ---- Capricornus ----
  ["Deneb Algedi", 21.78, -16.13, 2.87, "Cap", "A"],
  ["Dabih", 20.35, -14.78, 3.08, "Cap", "F"],
  ["Nashira", 21.67, -16.66, 3.68, "Cap", "F"],
  ["Algedi", 20.29, -12.51, 3.57, "Cap", "G"],
  ["Zeta Cap", 21.44, -22.41, 3.74, "Cap", "G"],

  // ---- Aquarius ----
  ["Sadalsuud", 21.53, -5.57, 2.91, "Aqr", "G"],
  ["Sadalmelik", 22.10, -0.32, 2.96, "Aqr", "G"],
  ["Skat", 22.91, -15.82, 3.27, "Aqr", "A"],
  ["Lambda Aqr", 22.88, -7.58, 3.74, "Aqr", "M"],
  ["Eta Aqr", 22.59, -0.12, 4.02, "Aqr", "B"],

  // ---- Ara ----
  ["Beta Ara", 17.42, -55.53, 2.85, "Ara", "K"],
  ["Alpha Ara", 17.53, -49.88, 2.95, "Ara", "B"],
  ["Zeta Ara", 16.98, -55.99, 3.13, "Ara", "K"],
  ["Gamma Ara", 17.42, -56.38, 3.34, "Ara", "B"],

  // ---- Grus ----
  ["Alnair", 22.14, -46.96, 1.74, "Gru", "B"],
  ["Gruid", 22.71, -46.88, 2.10, "Gru", "M"],
  ["Gamma Gru", 21.90, -37.36, 3.01, "Gru", "B"],
  ["Delta1 Gru", 22.49, -43.50, 3.97, "Gru", "G"],

  // ---- Pavo ----
  ["Peacock", 20.43, -56.74, 1.94, "Pav", "B"],
  ["Beta Pav", 20.75, -66.20, 3.42, "Pav", "A"],

  // ---- Tucana ----
  ["Alpha Tuc", 22.31, -60.26, 2.86, "Tuc", "K"],

  // ---- Phoenix ----
  ["Ankaa", 0.44, -42.31, 2.39, "Phe", "K"],
  ["Beta Phe", 1.10, -46.72, 3.31, "Phe", "G"],

  // ---- Triangulum Australe ----
  ["Atria", 16.81, -69.03, 1.92, "TrA", "K"],
  ["Beta TrA", 15.92, -63.43, 2.85, "TrA", "F"],
  ["Gamma TrA", 15.32, -68.68, 2.89, "TrA", "A"],

  // ---- Musca ----
  ["Alpha Mus", 12.62, -69.14, 2.69, "Mus", "B"],
  ["Beta Mus", 12.77, -68.11, 3.05, "Mus", "B"],

  // ---- Volans ----
  ["Gamma Vol", 7.14, -70.50, 3.60, "Vol", "K"],
  ["Beta Vol", 8.43, -66.14, 3.77, "Vol", "K"],

  // ---- Corona Australis ----
  ["Meridiana", 19.17, -37.90, 4.10, "CrA", "A"],
  ["Beta CrA", 19.17, -39.34, 4.11, "CrA", "K"],

  // ---- Sagitta ----
  ["Gamma Sge", 19.98, 19.49, 3.47, "Sge", "M"],
  ["Delta Sge", 19.79, 18.53, 3.82, "Sge", "M"],

  // ---- Delphinus ----
  ["Rotanev", 20.63, 14.60, 3.63, "Del", "F"],
  ["Sualocin", 20.66, 15.91, 3.77, "Del", "B"],

  // ---- Equuleus ----
  ["Kitalpha", 21.26, 5.25, 3.92, "Equ", "A"],

  // ---- Scutum ----
  ["Alpha Sct", 18.59, -8.24, 3.85, "Sct", "K"],

  // ---- Vulpecula ----
  ["Anser", 19.48, 24.66, 4.44, "Vul", "M"],

  // ---- Norma ----
  ["Gamma2 Nor", 16.33, -50.16, 4.02, "Nor", "G"],

  // ---- Circinus ----
  ["Alpha Cir", 14.71, -64.98, 3.19, "Cir", "A"],

  // ---- Pictor ----
  ["Alpha Pic", 6.80, -61.94, 3.27, "Pic", "A"],

  // ---- Dorado ----
  ["Alpha Dor", 4.57, -55.04, 3.27, "Dor", "A"],

  // ---- Fornax ----
  ["Dalim", 3.20, -28.99, 3.87, "For", "F"],

  // ---- Sculptor ----
  ["Alpha Scl", 0.98, -29.36, 4.31, "Scl", "B"],

  // ---- Cetus ----
  ["Diphda", 0.73, -17.99, 2.02, "Cet", "K"],
  ["Menkar", 3.04, 4.09, 2.53, "Cet", "M"],
  ["Mira", 2.32, -2.98, 3.04, "Cet", "M"],
  ["Tau Cet", 1.73, -15.94, 3.50, "Cet", "G"],
  ["Baten Kaitos", 1.86, -10.34, 3.74, "Cet", "K"],

  // ---- Caelum ----
  ["Alpha Cae", 4.68, -41.86, 4.45, "Cae", "F"],

  // ---- Horologium ----
  ["Alpha Hor", 4.23, -42.29, 3.86, "Hor", "K"],

  // ---- Reticulum ----
  ["Alpha Ret", 4.24, -62.47, 3.35, "Ret", "G"],

  // ---- Hydrus ----
  ["Beta Hyi", 0.43, -77.25, 2.80, "Hyi", "G"],
  ["Alpha Hyi", 1.98, -61.57, 2.86, "Hyi", "F"],

  // ---- Indus ----
  ["Alpha Ind", 20.63, -47.29, 3.11, "Ind", "K"],

  // ---- Microscopium (faint, but included for completeness) ----
  ["Gamma Mic", 21.02, -32.26, 4.67, "Mic", "G"],

  // ---- Telescopium ----
  ["Alpha Tel", 18.45, -45.97, 3.51, "Tel", "B"],

  // ---- Chamaeleon ----
  ["Alpha Cha", 8.31, -76.92, 4.07, "Cha", "F"],

  // ---- Lacerta ----
  ["Alpha Lac", 22.52, 50.28, 3.77, "Lac", "A"],

  // ---- Leo Minor ----
  ["Praecipua", 10.89, 34.21, 3.83, "LMi", "K"],

  // ---- Lynx ----
  ["Alpha Lyn", 9.35, 34.39, 3.13, "Lyn", "K"],

  // ---- Camelopardalis ----
  ["Beta Cam", 5.06, 60.44, 4.03, "Cam", "G"],

  // ---- Sextans ----
  ["Alpha Sex", 10.13, -0.37, 4.49, "Sex", "A"],

  // ---- Antlia ----
  ["Alpha Ant", 10.45, -31.07, 4.25, "Ant", "K"],

  // ---- Pyxis ----
  ["Alpha Pyx", 8.73, -33.19, 3.68, "Pyx", "B"],

  // ---- Compass / Octans (south pole) ----
  ["Nu Oct", 21.69, -77.39, 3.76, "Oct", "K"],
  ["Sigma Oct", 21.14, -88.96, 5.42, "Oct", "F"],

  // ---- Missing stars for constellation lines ----
  // Corona Borealis
  ["Theta CrB", 15.55, 31.36, 4.14, "CrB", "B"],
  ["Beta CrB", 15.46, 29.11, 3.68, "CrB", "F"],
  ["Delta CrB", 15.83, 26.07, 4.63, "CrB", "G"],
  ["Epsilon CrB", 15.96, 26.88, 4.15, "CrB", "K"],
  // Draco
  // Xi Dra removed (= Grumium)
  ["Edasich", 15.42, 58.97, 3.29, "Dra", "K"],
  ["Chi Dra", 18.35, 72.73, 3.57, "Dra", "F"],
  // Cancer
  ["Iota Cnc", 8.78, 28.76, 4.02, "Cnc", "G"],
  // Hydra
  ["Delta Hya", 8.63, 5.70, 4.16, "Hya", "A"],
  ["Sigma Hya", 8.85, 3.34, 4.44, "Hya", "K"],
  ["Eta Hya", 8.72, 3.40, 4.30, "Hya", "B"],
  // Serpens
  ["Gamma Ser", 15.94, 15.66, 3.85, "Ser", "F"],
  ["Delta Ser", 15.58, 10.54, 3.80, "Ser", "F"],
];
