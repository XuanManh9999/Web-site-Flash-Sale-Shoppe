const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;
const DB_PATH = "./data.db";

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static("."));

// Initialize database
function initDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error("Error opening database:", err);
        reject(err);
        return;
      }
      console.log("Connected to SQLite database");
    });

    // Create table for time slot data
    db.run(
      `
      CREATE TABLE IF NOT EXISTS time_slot_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time_slot TEXT NOT NULL UNIQUE,
        link_mapping TEXT,
        sub_id_mapping TEXT,
        reason_mapping TEXT,
        product_cache TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating table:", err);
          reject(err);
          return;
        }

        // Create table for system status
        db.run(
          `
          CREATE TABLE IF NOT EXISTS system_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            is_active INTEGER DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `,
          (err) => {
            if (err) {
              console.error("Error creating system_status table:", err);
              reject(err);
              return;
            }

            // Initialize system status if not exists
            db.run(
              `INSERT OR IGNORE INTO system_status (id, is_active) VALUES (1, 1)`,
              (err) => {
                if (err) {
                  console.error("Error initializing system status:", err);
                  reject(err);
                } else {
                  console.log("Database initialized");
                  resolve(db);
                }
              }
            );
          }
        );
      }
    );
  });
}

let db;

// Initialize database on startup
initDatabase()
  .then((database) => {
    db = database;
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });

// API: Get all time slot data
app.get("/api/data", (req, res) => {
  db.all("SELECT * FROM time_slot_data", (err, rows) => {
    if (err) {
      console.error("Error fetching data:", err);
      res.status(500).json({ success: false, error: err.message });
      return;
    }

    // Convert rows to object format
    const result = {};
    rows.forEach((row) => {
      result[row.time_slot] = {
        linkMapping: row.link_mapping ? JSON.parse(row.link_mapping) : {},
        subIdMapping: row.sub_id_mapping ? JSON.parse(row.sub_id_mapping) : {},
        reasonMapping: row.reason_mapping ? JSON.parse(row.reason_mapping) : {},
        productCache: row.product_cache ? JSON.parse(row.product_cache) : {},
      };
    });

    res.json(result);
  });
});

// API: Get data for specific time slot
app.get("/api/data/:timeSlot", (req, res) => {
  const timeSlot = decodeURIComponent(req.params.timeSlot);

  db.get(
    "SELECT * FROM time_slot_data WHERE time_slot = ?",
    [timeSlot],
    (err, row) => {
      if (err) {
        console.error("Error fetching time slot data:", err);
        res.status(500).json({ success: false, error: err.message });
        return;
      }

      if (!row) {
        res.json({
          linkMapping: {},
          subIdMapping: {},
          reasonMapping: {},
          productCache: {},
        });
        return;
      }

      res.json({
        linkMapping: row.link_mapping ? JSON.parse(row.link_mapping) : {},
        subIdMapping: row.sub_id_mapping ? JSON.parse(row.sub_id_mapping) : {},
        reasonMapping: row.reason_mapping ? JSON.parse(row.reason_mapping) : {},
        productCache: row.product_cache ? JSON.parse(row.product_cache) : {},
      });
    }
  );
});

// API: Save time slot data
app.post("/api/data", (req, res) => {
  const { timeSlot, data } = req.body;

  if (!timeSlot) {
    res.status(400).json({ success: false, error: "timeSlot is required" });
    return;
  }

  const linkMapping = JSON.stringify(data.linkMapping || {});
  const subIdMapping = JSON.stringify(data.subIdMapping || {});
  const reasonMapping = JSON.stringify(data.reasonMapping || {});
  const productCache = JSON.stringify(data.productCache || {});

  db.run(
    `INSERT INTO time_slot_data (time_slot, link_mapping, sub_id_mapping, reason_mapping, product_cache, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(time_slot) DO UPDATE SET
       link_mapping = excluded.link_mapping,
       sub_id_mapping = excluded.sub_id_mapping,
       reason_mapping = excluded.reason_mapping,
       product_cache = excluded.product_cache,
       updated_at = CURRENT_TIMESTAMP`,
    [timeSlot, linkMapping, subIdMapping, reasonMapping, productCache],
    function (err) {
      if (err) {
        console.error("Error saving data:", err);
        res.status(500).json({ success: false, error: err.message });
        return;
      }

      res.json({ success: true, message: "Data saved successfully" });
    }
  );
});

// API: Save all time slot data (batch)
app.post("/api/data/batch", (req, res) => {
  const allData = req.body;

  if (!allData || typeof allData !== "object") {
    res.status(400).json({ success: false, error: "Invalid data format" });
    return;
  }

  const timeSlots = Object.keys(allData);
  let completed = 0;
  let errors = [];

  if (timeSlots.length === 0) {
    res.json({ success: true, message: "No data to save" });
    return;
  }

  timeSlots.forEach((timeSlot) => {
    const data = allData[timeSlot];
    const linkMapping = JSON.stringify(data.linkMapping || {});
    const subIdMapping = JSON.stringify(data.subIdMapping || {});
    const reasonMapping = JSON.stringify(data.reasonMapping || {});
    const productCache = JSON.stringify(data.productCache || {});

    db.run(
      `INSERT INTO time_slot_data (time_slot, link_mapping, sub_id_mapping, reason_mapping, product_cache, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(time_slot) DO UPDATE SET
         link_mapping = excluded.link_mapping,
         sub_id_mapping = excluded.sub_id_mapping,
         reason_mapping = excluded.reason_mapping,
         product_cache = excluded.product_cache,
         updated_at = CURRENT_TIMESTAMP`,
      [timeSlot, linkMapping, subIdMapping, reasonMapping, productCache],
      function (err) {
        if (err) {
          console.error(`Error saving data for ${timeSlot}:`, err);
          errors.push({ timeSlot, error: err.message });
        }

        completed++;
        if (completed === timeSlots.length) {
          if (errors.length > 0) {
            res.status(500).json({ success: false, errors });
          } else {
            res.json({ success: true, message: "All data saved successfully" });
          }
        }
      }
    );
  });
});

// API: Delete time slot data
app.delete("/api/data/:timeSlot", (req, res) => {
  const timeSlot = decodeURIComponent(req.params.timeSlot);

  db.run(
    "DELETE FROM time_slot_data WHERE time_slot = ?",
    [timeSlot],
    function (err) {
      if (err) {
        console.error("Error deleting time slot data:", err);
        res.status(500).json({ success: false, error: err.message });
        return;
      }

      res.json({ success: true, message: "Data deleted successfully" });
    }
  );
});

// API: Delete all data
app.delete("/api/data", (req, res) => {
  db.run("DELETE FROM time_slot_data", (err) => {
    if (err) {
      console.error("Error deleting all data:", err);
      res.status(500).json({ success: false, error: err.message });
      return;
    }

    res.json({ success: true, message: "All data deleted successfully" });
  });
});

// API: Get list of time slots that have data in DB
app.get("/api/time-slots", (req, res) => {
  db.all("SELECT time_slot FROM time_slot_data", (err, rows) => {
    if (err) {
      console.error("Error fetching time slots:", err);
      res.status(500).json({ success: false, error: err.message });
      return;
    }

    const timeSlots = rows.map((row) => row.time_slot);
    res.json({ success: true, data: timeSlots });
  });
});

// API: Get system status
app.get("/api/system-status", (req, res) => {
  db.get("SELECT is_active FROM system_status WHERE id = 1", (err, row) => {
    if (err) {
      console.error("Error fetching system status:", err);
      res.status(500).json({ success: false, error: err.message });
      return;
    }

    const isActive = row ? row.is_active === 1 : true; // Default to active if not found
    res.json({ success: true, isActive: isActive });
  });
});

// API: Update system status
app.post("/api/system-status", (req, res) => {
  const { isActive } = req.body;

  if (typeof isActive !== "boolean") {
    res
      .status(400)
      .json({ success: false, error: "isActive must be a boolean" });
    return;
  }

  db.run(
    `UPDATE system_status SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    [isActive ? 1 : 0],
    function (err) {
      if (err) {
        console.error("Error updating system status:", err);
        res.status(500).json({ success: false, error: err.message });
        return;
      }

      res.json({
        success: true,
        message: "System status updated",
        isActive: isActive,
      });
    }
  );
});

// Start server
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server is running on http://103.200.23.43:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  if (db) {
    db.close((err) => {
      if (err) {
        console.error("Error closing database:", err);
      } else {
        console.log("Database connection closed");
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});
