# 🛒 E-commerce Synchronization and Logistics Management System

# High-Impact Web Platform for Stock and Sales Optimization

---

## 🎯 About the Project

This project involved the development of a comprehensive web platform designed to resolve critical synchronization and workflow issues for an automotive parts e-commerce store managing a high volume of listings (over 1,000).

The core goal was to **eliminate stock dissonance** caused by the complexity of the Mercado Livre listing structure (kit/piece, Classic/Premium) and **automate logistics dispatch**, resulting in an **increase of over 20% in gross revenue**.

### 💡 Key Features and Solutions

* **Atomic Synchronization:** Implementation of a "watcher" function in the Backend that ensures a stock deduction for a wheel is instantly reflected across **all related ad instances**, eliminating the risk of selling out-of-stock items.
* **Automated Logistics Decision:** The manual verification process was replaced. The system now checks the combined supplier stock (São Paulo, Santa Catarina, and Paraná) at the moment of sale to instantly define the collection status: **Ready for Delivery** (Pronta Entrega) or **Request from South** (Transfer needed).
* **Optimized Picking Flow:** Development of a **"Wheels for Collection" Panel** in the Frontend, enhancing efficiency by allowing the operator to mark an item as collected and immediately remove it from the pending list.
* **Risk Metrics:** Generation of the **Top 5 Best-Selling Wheels** and the **Attention/Risk Index** (Sales vs. Total Stock), providing strategic *insights* for proactive inventory management.

---

## 💻 Technologies and Architecture

The system is built on a robust and secure technological stack:

* **Backend (Synchronization Logic):**
    * **Node.js/Express:** Core engine for all business logic, coordination, and handling of complex transactions (stock deduction).
    * **Sequelize ORM:** Used for complex queries, transactions, and robust data *merge* operations between stock tables.
* **Database:**
    * **PostgreSQL:** Employed to ensure data integrity and persistence, crucial for strict stock control and auditing.
* **Frontend (User Interface):**
    * **React:** Building a fast, interactive user interface (Dashboard, Collection List).
    * **Tailwind CSS:** Utilized for rapid and responsive UI design.
* **Security:**
    * **JSON Web Tokens (JWT):** Implemented to guarantee authentication and secure all API routes.

---

## 🚀 Business Impact

This project transformed operational chaos into a predictable workflow, enabling the client's team to focus on sales
