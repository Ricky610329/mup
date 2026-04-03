// Constellation line definitions
// Each constellation maps star names to line segments connecting them
const CONSTELLATIONS = {
  "Orion": {
    displayName: "Orion",
    lines: [["Betelgeuse","Bellatrix"],["Betelgeuse","Alnitak"],["Bellatrix","Mintaka"],["Alnitak","Alnilam"],["Alnilam","Mintaka"],["Alnitak","Saiph"],["Mintaka","Rigel"],["Rigel","Saiph"]]
  },
  "Ursa Major": {
    displayName: "Ursa Major",
    lines: [["Dubhe","Merak"],["Merak","Phecda"],["Phecda","Megrez"],["Megrez","Alioth"],["Alioth","Mizar"],["Mizar","Alkaid"],["Megrez","Dubhe"]]
  },
  "Ursa Minor": {
    displayName: "Ursa Minor",
    lines: [["Polaris","Delta UMi"],["Delta UMi","Epsilon UMi"],["Epsilon UMi","Zeta UMi"],["Zeta UMi","Eta UMi"],["Eta UMi","Pherkad"],["Pherkad","Kochab"],["Kochab","Zeta UMi"]]
  },
  "Cassiopeia": {
    displayName: "Cassiopeia",
    lines: [["Caph","Schedar"],["Schedar","Gamma Cas"],["Gamma Cas","Ruchbah"],["Ruchbah","Segin"]]
  },
  "Leo": {
    displayName: "Leo",
    lines: [["Regulus","Algieba"],["Algieba","Ras Elased"],["Algieba","Zosma"],["Zosma","Denebola"],["Zosma","Chertan"],["Chertan","Regulus"]]
  },
  "Scorpius": {
    displayName: "Scorpius",
    lines: [["Graffias","Dschubba"],["Dschubba","Antares"],["Antares","Epsilon Sco"],["Epsilon Sco","Shaula"],["Shaula","Kappa Sco"],["Kappa Sco","Sargas"],["Sargas","Eta Sco"]]
  },
  "Gemini": {
    displayName: "Gemini",
    lines: [["Castor","Pollux"],["Castor","Tejat"],["Tejat","Mebsuta"],["Pollux","Wasat"],["Wasat","Alhena"]]
  },
  "Taurus": {
    displayName: "Taurus",
    lines: [["Aldebaran","Elnath"],["Aldebaran","Alcyone"],["Aldebaran","Zeta Tau"]]
  },
  "Canis Major": {
    displayName: "Canis Major",
    lines: [["Sirius","Mirzam"],["Sirius","Adhara"],["Adhara","Wezen"],["Wezen","Aludra"],["Adhara","Furud"]]
  },
  "Cygnus": {
    displayName: "Cygnus",
    lines: [["Deneb","Sadr"],["Sadr","Gienah Cyg"],["Sadr","Delta Cyg"],["Sadr","Albireo"]]
  },
  "Lyra": {
    displayName: "Lyra",
    lines: [["Vega","Sheliak"],["Vega","Zeta Lyr"],["Sheliak","Sulafat"],["Zeta Lyr","Delta2 Lyr"],["Sulafat","Delta2 Lyr"]]
  },
  "Aquila": {
    displayName: "Aquila",
    lines: [["Altair","Tarazed"],["Altair","Alshain"],["Tarazed","Zeta Aql"],["Alshain","Delta Aql"]]
  },
  "Virgo": {
    displayName: "Virgo",
    lines: [["Spica","Porrima"],["Porrima","Auva"],["Porrima","Vindemiatrix"],["Auva","Zavijava"]]
  },
  "Sagittarius": {
    displayName: "Sagittarius",
    lines: [["Kaus Australis","Kaus Media"],["Kaus Media","Kaus Borealis"],["Kaus Media","Nash"],["Kaus Australis","Ascella"],["Ascella","Nunki"],["Nunki","Kaus Borealis"]]
  },
  "Andromeda": {
    displayName: "Andromeda",
    lines: [["Alpheratz","Delta And"],["Delta And","Mirach"],["Mirach","Almach"]]
  },
  "Perseus": {
    displayName: "Perseus",
    lines: [["Mirfak","Delta Per"],["Mirfak","Epsilon Per"],["Epsilon Per","Algol"],["Algol","Zeta Per"]]
  },
  "Pegasus": {
    displayName: "Pegasus",
    lines: [["Markab","Scheat"],["Scheat","Alpheratz"],["Alpheratz","Algenib"],["Algenib","Markab"]]
  },
  "Crux": {
    displayName: "Crux",
    lines: [["Acrux","Gacrux"],["Mimosa","Delta Cru"]]
  },
  "Centaurus": {
    displayName: "Centaurus",
    lines: [["Rigil Kent","Hadar"],["Hadar","Epsilon Cen"],["Epsilon Cen","Menkent"]]
  },
  "Aries": {
    displayName: "Aries",
    lines: [["Hamal","Sheratan"],["Sheratan","Mesarthim"]]
  },
  "Bootes": {
    displayName: "Boötes",
    lines: [["Arcturus","Izar"],["Arcturus","Muphrid"],["Izar","Seginus"],["Seginus","Nekkar"]]
  },

  // --- New constellations ---

  "Ophiuchus": {
    displayName: "Ophiuchus",
    lines: [["Rasalhague","Cebalrai"],["Rasalhague","Yed Prior"],["Yed Prior","Sabik"],["Sabik","Cebalrai"]]
  },
  "Corona Borealis": {
    displayName: "Corona Borealis",
    lines: [["Alphecca","Theta CrB"],["Theta CrB","Beta CrB"],["Alphecca","Gamma CrB"],["Gamma CrB","Delta CrB"],["Delta CrB","Epsilon CrB"]]
  },
  "Draco": {
    displayName: "Draco",
    lines: [["Eltanin","Rastaban"],["Rastaban","Grumium"],["Grumium","Thuban"],["Thuban","Edasich"],["Edasich","Chi Dra"]]
  },
  "Cepheus": {
    displayName: "Cepheus",
    lines: [["Alderamin","Errai"],["Errai","Alfirk"],["Alfirk","Zeta Cep"],["Zeta Cep","Alderamin"]]
  },
  "Corvus": {
    displayName: "Corvus",
    lines: [["Gienah Crv","Algorab"],["Algorab","Kraz"],["Kraz","Minkar"],["Minkar","Gienah Crv"]]
  },
  "Triangulum": {
    displayName: "Triangulum",
    lines: [["Mothallah","Beta Tri"],["Beta Tri","Gamma Tri"],["Gamma Tri","Mothallah"]]
  },
  "Lepus": {
    displayName: "Lepus",
    lines: [["Arneb","Nihal"],["Arneb","Mu Lep"],["Nihal","Epsilon Lep"]]
  },
  "Columba": {
    displayName: "Columba",
    lines: [["Phact","Wazn"]]
  },
  "Canis Minor": {
    displayName: "Canis Minor",
    lines: [["Procyon","Gomeisa"]]
  },
  "Auriga": {
    displayName: "Auriga",
    lines: [["Capella","Menkalinan"],["Menkalinan","Mahasim"],["Mahasim","Elnath"],["Capella","Hassaleh"],["Hassaleh","Mahasim"]]
  },
  "Libra": {
    displayName: "Libra",
    lines: [["Zubeneschamali","Zubenelgenubi"],["Zubenelgenubi","Sigma Lib"],["Sigma Lib","Upsilon Lib"],["Upsilon Lib","Zubeneschamali"]]
  },
  "Cancer": {
    displayName: "Cancer",
    lines: [["Tarf","Acubens"],["Acubens","Asellus Australis"],["Asellus Australis","Asellus Borealis"],["Asellus Borealis","Iota Cnc"]]
  },
  "Pisces": {
    displayName: "Pisces",
    lines: [["Eta Psc","Alpha Psc"],["Alpha Psc","Omega Psc"],["Omega Psc","Gamma Psc"]]
  },
  "Lupus": {
    displayName: "Lupus",
    lines: [["Alpha Lup","Beta Lup"]]
  },
  "Puppis": {
    displayName: "Puppis",
    lines: [["Naos","Pi Pup"]]
  },
  "Vela": {
    displayName: "Vela",
    lines: [["Gamma Vel","Delta Vel"],["Delta Vel","Kappa Vel"],["Kappa Vel","Suhail"],["Suhail","Gamma Vel"]]
  },
  "Hydra": {
    displayName: "Hydra",
    lines: [["Alphard","Zeta Hya"],["Zeta Hya","Epsilon Hya"],["Epsilon Hya","Delta Hya"],["Delta Hya","Sigma Hya"],["Sigma Hya","Eta Hya"]]
  },
  "Serpens": {
    displayName: "Serpens",
    lines: [["Unukalhai","Beta Ser"],["Beta Ser","Gamma Ser"],["Gamma Ser","Delta Ser"]]
  }
};
