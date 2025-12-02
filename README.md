

# Stock Data & Trading Strategy API

A high-performance RESTful API built with FastAPI and PostgreSQL to manage stock market OHLCV data and run a Moving Average Crossover trading strategy. The project is fully containerized using Docker and uses Prisma ORM for type-safe and precise financial database operations.

---

## Features

- Stock Data CRUD  
  Efficient storage and retrieval of OHLCV (Open, High, Low, Close, Volume) data.

- Algorithmic Trading Strategy  
  Implements a Moving Average Crossover logic:
  - Short-term SMA: 10 days
  - Long-term SMA: 50 days
  - Generates Buy/Sell/Hold signals

- Robust Validation  
  Powered by Pydantic to ensure:
  - High ≥ Low  
  - No negative values  
  - Valid timestamps  

- Accurate Financial Precision  
  Prisma configured with:


enable_experimental_decimal = true


to avoid floating-point precision errors.

- Containerized Environment  
Fully Dockerized — run everything with one command.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | FastAPI (Python 3.10) |
| Database | PostgreSQL 15 |
| ORM | Prisma Client Python |
| Data Processing | Pandas |
| Testing | Unittest, Pytest |
| Infrastructure | Docker + Docker Compose |

---

## Installation & Setup

### Prerequisites
- Docker Desktop installed and running.

---

### 1. Start the Application

```sh
docker-compose up --build
````

Once you see:

```
Application startup complete.
```

Your services are ready.

| Service      | URL                                                      |
| ------------ | -------------------------------------------------------- |
| API Base URL | [http://localhost:8500](http://localhost:8500)           |
| Swagger Docs | [http://localhost:8500/docs](http://localhost:8500/docs) |
| Database     | localhost:5435                                           |

---

### 2. Seed Database with Sample Data

Export your Google Sheet as `data.csv` and place it in the project root.

Run:

```sh
docker-compose exec web sh
python seed_data.py
```

---

## API Endpoints

| Method | Endpoint                | Description                               |
| ------ | ----------------------- | ----------------------------------------- |
| GET    | `/data`                 | Fetch all stored stock records            |
| POST   | `/data`                 | Insert a new OHLCV record                 |
| GET    | `/strategy/performance` | Run the moving average crossover strategy |

---

### Example Strategy Response

```json
{
  "strategy": "Moving Average Crossover (10/50)",
  "total_records": 100,
  "buy_signals_count": 5,
  "sell_signals_count": 4,
  "current_market_position": "BUY",
  "last_close_price": 153.00,
  "sma_short_last": 151.20,
  "sma_long_last": 148.50
}
```

---

## Running Tests

Inside the running container:

```sh
docker-compose exec web sh
python -m unittest tests/test_app.py
```

### What’s Tested?

* Input validation (negative values, Low > High, invalid dates)
* SMA strategy logic using mock historical data
* API endpoint response and behavior

---

## Project Structure

```
stock-app/
├── app/
│   ├── main.py          # FastAPI application & endpoints
│   ├── models.py        # Pydantic validation models
│   └── strategy.py      # Trading logic using Pandas
├── prisma/
│   └── schema.prisma    # Prisma DB schema
├── tests/
│   └── test_app.py      # Unit tests
├── Dockerfile           # Image build instructions
├── docker-compose.yml   # Application + database orchestration
├── requirements.txt     # Python dependencies
└── seed_data.py         # CSV import script
```

