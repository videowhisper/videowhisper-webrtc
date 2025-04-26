const mysql = require('mysql');

class Database {

  constructor() {
    this.connection = mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT, // 3306
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    this.devMode = ( process.env.NODE_ENV || "development" ) === "development";
  }

  query(sql, args) {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, args, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.connection.end(err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  getAccounts() {
    return new Promise((resolve, reject) => {
      this.query(`
        SELECT a.id, a.name, a.token, a.properties, p.properties AS plan
        FROM accounts a
        LEFT JOIN plans p ON a.planId = p.id
      `)
      .then(rows => {
        const accounts = rows.reduce((acc, row) => {
          const { id, name, token, properties, plan } = row;
          const props = properties ? JSON.parse(properties) : {};
          const planProps = plan ? JSON.parse(plan) : {};
          if (token) {
            acc[token] = { id, name, token, properties: props, plan: planProps };
          }
          return acc;
        }, {});
        console.log(`Loaded ${Object.keys(accounts).length} account(s) from the database`);
        resolve(accounts);
      })
      .catch(err => {
        console.error('Error loading accounts and plans from the database:', err);
        reject(err);
      })
      .finally(() => {
        this.close();
      });
    });
  }
  
}

module.exports = Database;

/* SQL structure of tables used in this module:
DROP TABLE IF EXISTS accounts;
  CREATE TABLE accounts (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL,
    properties TEXT NOT NULL,
    planId INT,
    meta TEXT,
    contactId INT,
    created INT,
    PRIMARY KEY (id),
    UNIQUE KEY (token), 
    KEY (planId),
    KEY (contactId),
    KEY (created)
  );

  DROP TABLE IF EXISTS plans;
  CREATE TABLE plans (
    id INT NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    properties TEXT NOT NULL,
    PRIMARY KEY (id)
  );
*/