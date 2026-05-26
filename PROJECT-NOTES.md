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

- # MaxAssistant Project Notes

## Project Identity

MaxAssistant is an AI Property Intelligence System for real estate on the Bulgarian Black Sea coast.

It is not a standard property website, filter system, or demo chatbot. Its purpose is to understand property searches, reason over trusted knowledge, discover external opportunities, normalize property data, score relevance, and behave like a real AI real estate consultant.

## Core Architecture

### 1. Trusted Local Knowledge Layer

The trusted source is NewHome Bulgaria / local database.

This layer is the truth layer.

It is used for:

- trusted facts
- AI reasoning
- scoring
- complex knowledge
- beach intelligence
- construction and Act 16 status
- infrastructure
- local property intelligence

Local database information has the highest priority.

### 2. External Discovery Layer

External sources include:

- Alo.bg
- Imot.bg
- Realistimo
- trusted investor sites

These sources are not the final truth. They are used for:

- market discovery
- additional opportunities
- fallback results
- comparison
- extracting candidate listings

External information must be normalized and treated carefully.

## Key Principle

NewHome/local database is the source of truth.

External sites are discovery sources.

If there is conflict between trusted local knowledge and external text, local trusted knowledge wins.

## Structured Property Intelligence Objects

The normalized format for every property is called:

**structured property intelligence object**

Every local or external listing should be converted into this type of object before visualization, scoring, deduplication, or AI reasoning.

Target structure:

```js
{
  title,
  price,
  area,
  rooms,
  floor,
  bathrooms,
  toilets,
  location,
  complex,
  property_type,
  construction_status,
  act16_status,
  beach_distance,
  beach_category,
  layout_details,
  complex_amenities,
  maintenance_fee,
  image,
  url,
  source,
  reasons,
  aiScore
}
