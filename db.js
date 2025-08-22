// db.js
const mysql = require('mysql2/promise');
require('dotenv').config();

// Cria um "pool" de ligações. É muito mais eficiente do que criar
// uma nova ligação para cada consulta, especialmente para um bot.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10, // Número máximo de ligações no pool
    queueLimit: 0
});

console.log('Pool de ligações com o MySQL criado com sucesso.');

// Exporta o pool para que possa ser usado noutros ficheiros
module.exports = pool;