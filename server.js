require('dotenv').config();
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const { MongoClient } = require('mongodb');
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

// Load Google Sheets credentials
const auth = new GoogleAuth({
  credentials: {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

const MONGO_URI = process.env.MONGO_URI;
const SHEET_ID = process.env.SHEET_ID;
const DATABASE_NAME = process.env.DATABASE_NAME;



async function getCollectionNames(client) {
  const db = client.db(DATABASE_NAME);
  return db.listCollections().toArray().then(cols => cols.map(c => c.name));
}

async function updateSheet(collectionName, data) {
  try {
    const sheetData = data.length > 0 ? [Object.keys(data[0]), ...data.map(doc => Object.values(doc))] : [["No Data"]];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${collectionName}!A1`,
      valueInputOption: "RAW",
      resource: { values: sheetData }
    });
    console.log(`✅ Updated sheet: ${collectionName}`);
  } catch (error) {
    console.error(`❌ Error updating sheet ${collectionName}:`, error);
  }
}

async function initializeSheets(client) {
  const collections = await getCollectionNames(client);
  const db = client.db(DATABASE_NAME);
  for (const collectionName of collections) {
    const data = await db.collection(collectionName).find().toArray();
    await updateSheet(collectionName, data);
  }
}

async function listenToMongoDBChanges() {
  const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    await client.connect();
    console.log("📡 Connected to MongoDB, initializing Google Sheets...");
    
    await initializeSheets(client); // Fill sheets with existing data

    const collections = await getCollectionNames(client);
    console.log(`📡 Listening for changes in collections: ${collections.join(', ')}`);

    collections.forEach(collectionName => {
      const db = client.db(DATABASE_NAME);
      const collection = db.collection(collectionName);
      const changeStream = collection.watch();
      
      changeStream.on("change", async (change) => {
        console.log(`🔄 Change detected in ${collectionName}:`, change);
        const newData = await collection.find().toArray();
        await updateSheet(collectionName, newData);
      });
    });

  } catch (error) {
    console.error("❌ Error:", error);
  }
}

listenToMongoDBChanges();

