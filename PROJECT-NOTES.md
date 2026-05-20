# MaxAssistant – PROJECT NOTES

## Основна идея
AI property search система за недвижими имоти по българското Черноморие.

Системата комбинира:
- реални имоти
- AI knowledge layer
- ranking engine
- lifestyle comparison
- инфраструктура
- AI reasoning

---

# Основни файлове

## property-search.html
Основната AI търсачка.

Съдържа:
- филтрите
- ranking engine
- AI logic
- renderResults()
- scroll logic
- free text AI matching

---

## style.css
Главният стил.

Съдържа:
- responsive layout
- cards
- spacing
- mobile optimization
- results spacing

---

## data/properties.json
База с конкретни апартаменти.

Всеки имот съдържа:
- цена
- площ
- стаи
- бани
- балкони
- обзавеждане
- гледка
- етаж
- тип имот
- комплекс
- локация

Това е:
REAL PROPERTY DATABASE

---

## data/complexes.json
AI knowledge layer за комплексите.

Съдържа:
- инфраструктура
- lifestyle
- strengths
- weaknesses
- rental potential
- environment profile
- installment info
- act16 info

Това е:
AI CONTEXT DATABASE

---

# Архитектура

properties.json
→ конкретен имот

complexes.json
→ AI intelligence layer

property-search.html
→ ranking + AI matching

---

# Важни правила

## HARD FILTERS
Следните филтри са strict:
- location
- property type
- rooms
- budget

При mismatch:
return null

---

# Ranking Logic

Подреждане:
1. AI score
2. най-близка цена до бюджета
3. по-голяма площ

---

# Mobile UX

Текущият mobile layout е одобрен.
Да не се правят големи промени по navbar-а.

НЕ използваме hamburger menu засега.

---

# Текущо работещи комплекси

- City Residence
- Cascadas
- Green Life

---

# Следващи стъпки

- повече реални имоти
- снимки
- линкове към обяви
- advanced filters
- investor sync
- Excel import system
- AI extraction
