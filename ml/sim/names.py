"""Noms, prénoms tunisiens romanisés et gouvernorats."""

MALE = """Mohamed Ahmed Ali Mehdi Amine Youssef Hamza Karim Sami Nabil Walid Hichem Slim Anis Bilel Oussama Aymen Wael
Firas Khaled Riadh Lotfi Mourad Hatem Chokri Sofiene Ramzi Hedi Moez Fethi Tarek Skander Aziz Achraf Houssem Marouen
Seifeddine Ghassen Iheb Omar Nizar Jamel Mounir Adel Habib Kamel Ridha Sahbi Zied Makram Fares Rami Hassen Mootez
Yassine Taher Borhen Lassaad Raouf Wassim Montassar Nour Elyes Kais Mahdi Fedi Rayen Malek Hazem Yahya Khalil""".split()

FEMALE = """Fatma Amira Sarra Ines Mariem Rim Asma Salma Yasmine Emna Olfa Hela Sonia Leila Samia Nadia Houda Wafa Ahlem
Rania Imen Khaoula Chaima Siwar Rahma Eya Oumaima Hanen Manel Nesrine Sana Dorra Mouna Nawel Faten Hajer Sirine Meriem
Zeineb Latifa Najet Souad Raja Hayfa Ons Syrine Abir Maha Lamia Hana Nadia Jihen Marwa Takwa Wiem Yosra Afef Hend Samar""".split()

LAST = [
    "Ben Ali", "Trabelsi", "Gharbi", "Hammami", "Jebali", "Mejri", "Ayari", "Bouazizi", "Dridi", "Sassi", "Khelifi",
    "Chaabane", "Ben Salah", "Ben Amor", "Mansouri", "Jlassi", "Rezgui", "Zouari", "Karray", "Masmoudi", "Ellouze",
    "Baccouche", "Belhadj", "Ben Youssef", "Chebbi", "Ferjani", "Guesmi", "Hamdi", "Kchaou", "Laabidi", "Mabrouk",
    "Nasri", "Oueslati", "Riahi", "Saidi", "Tlili", "Zribi", "Abidi", "Bouslama", "Chouchane", "Dhaouadi", "Fakhfakh",
    "Gabsi", "Haddad", "Jaziri", "Kammoun", "Letaief", "Marzouki", "Mathlouthi", "Nouri", "Rekik", "Sfaxi", "Toumi",
    "Weslati", "Yahyaoui", "Zaied", "Ben Mahmoud", "Ben Romdhane", "Bouzid", "Charfi", "Derbel", "Frikha", "Ghorbel",
    "Hachicha", "Jemai", "Khemiri", "Ladhari", "Mahjoub", "Mzoughi", "Neji", "Rebai", "Sellami", "Snoussi", "Turki",
    "Amri", "Arfaoui", "Baklouti", "Bouaziz", "Chaouachi", "Elloumi", "Gasmi", "Hajji", "Jaballah", "Kacem", "Lahmar",
    "Maaloul", "Mekki", "Othmani", "Rahali", "Slama", "Souissi", "Tounsi", "Zaghdoudi", "Ben Hmida", "Ben Khalifa",
    "Boughanmi", "Chtioui", "Dhahri", "Feki", "Hannachi", "Jouini", "Kefi", "Mnif", "Ouerghi", "Sahli", "Selmi",
    "Triki", "Zghal", "Ben Hassine", "Ben Othman", "Bouhlel", "Cherif", "Essid", "Hamrouni", "Jaafar", "Khadhraoui",
]

# Gouvernorat de résidence (siège dans le Grand Tunis : sur-représenté)
GOVERNORATES = [
    ("Tunis", 20), ("Ariana", 12), ("Ben Arous", 12), ("Manouba", 6), ("Nabeul", 7), ("Zaghouan", 2), ("Bizerte", 5),
    ("Béja", 3), ("Jendouba", 3), ("Le Kef", 2), ("Siliana", 2), ("Sousse", 5), ("Monastir", 3), ("Mahdia", 2),
    ("Sfax", 4), ("Kairouan", 3), ("Kasserine", 2), ("Sidi Bouzid", 2), ("Gabès", 1.5), ("Médenine", 1.5),
    ("Tataouine", 0.5), ("Gafsa", 1.5), ("Tozeur", 0.5), ("Kébili", 0.5),
]

MARITAL = ["Célibataire", "Marié", "Divorcé", "Veuf"]
