const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

// Use node-fetch for older Node.js versions, or built-in fetch for Node.js 18+
let fetch;
try {
  // Try to use built-in fetch (Node.js 18+)
  if (typeof globalThis.fetch === "function") {
    fetch = globalThis.fetch;
  } else {
    // Fallback to node-fetch for older versions
    fetch = require("node-fetch");
  }
} catch (e) {
  // If node-fetch is not installed and fetch is not available, throw error
  console.error(
    "❌ Error: fetch is not available. Please install node-fetch: npm install node-fetch@2"
  );
  console.error("   Or upgrade to Node.js 18+ which has fetch built-in.");
  process.exit(1);
}

const app = express();
const PORT = 3000;
const DB_PATH = "./data.db";
// New API endpoint
const API_BASE_DEALXK = "https://addlivetag.com/api/data_dealxk.php";

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

        // Create table for products
        db.run(
          `
          CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time_slot TEXT NOT NULL,
            product_data TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(time_slot, product_data)
          )
        `,
          (err) => {
            if (err) {
              console.error("Error creating products table:", err);
              reject(err);
              return;
            }

            // Create index for faster queries
            db.run(
              `CREATE INDEX IF NOT EXISTS idx_products_time_slot ON products(time_slot)`,
              (err) => {
                if (err) {
                  console.error("Error creating products index:", err);
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
                          console.error(
                            "Error initializing system status:",
                            err
                          );
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

// ==================== DEALXK API PROXY ====================

// Helper function to convert Unix timestamp to time slot format (for matching)
function getTimeSlotFromTimestamp(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000);
  // Convert to Vietnam time (UTC+7)
  const vietnamTimeMs = date.getTime() + 7 * 60 * 60 * 1000;
  const vietnamDate = new Date(vietnamTimeMs);

  // Extract hour and minute
  const hours = vietnamDate.getUTCHours();
  const minutes = vietnamDate.getUTCMinutes();

  // Format: HHmm (e.g., "0000" for 00:00)
  return `${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}`;
}

// Helper function to normalize time slot for comparison
function normalizeTimeSlot(timeSlot) {
  if (!timeSlot) return null;
  // If it's a Unix timestamp, convert it
  if (/^\d+$/.test(timeSlot)) {
    return getTimeSlotFromTimestamp(parseInt(timeSlot));
  }
  // If it's in format "HH:mm", convert to "HHmm"
  if (/^\d{1,2}:\d{2}$/.test(timeSlot)) {
    const [hours, minutes] = timeSlot.split(":");
    return `${String(parseInt(hours)).padStart(2, "0")}${String(
      parseInt(minutes)
    ).padStart(2, "0")}`;
  }
  // If it's already in "HHmm" format, return as is
  if (/^\d{4}$/.test(timeSlot)) {
    return timeSlot;
  }
  return timeSlot;
}

// API: Get time slots from external API
app.get("/api/times", async (req, res) => {
  try {
    console.log("🔄 [Server] Fetching time slots from API...");

    // Fetch all products from API
    const response = await fetch(API_BASE_DEALXK, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (!response.ok) {
      throw new Error(
        `API returned ${response.status}: ${response.statusText}`
      );
    }

    const products = await response.json();

    if (!Array.isArray(products)) {
      throw new Error("API returned invalid data format");
    }

    // Extract unique time slots from products
    const timeSlotMap = new Map();

    products.forEach((product) => {
      if (product.sale_time) {
        // Use sale_time as the key (Unix timestamp)
        const timeSlot = String(product.sale_time);
        if (!timeSlotMap.has(timeSlot)) {
          // Format display: "HH:mm | DD/MM"
          const date = new Date(product.sale_time * 1000);
          const vietnamTimeMs = date.getTime() + 7 * 60 * 60 * 1000;
          const vietnamDate = new Date(vietnamTimeMs);

          const hours = String(vietnamDate.getUTCHours()).padStart(2, "0");
          const minutes = String(vietnamDate.getUTCMinutes()).padStart(2, "0");
          const day = String(vietnamDate.getUTCDate()).padStart(2, "0");
          const month = String(vietnamDate.getUTCMonth() + 1).padStart(2, "0");

          const displayTime = `${hours}:${minutes} | ${day}/${month}`;

          timeSlotMap.set(timeSlot, {
            start_time: timeSlot,
            real_time: displayTime,
          });
        }
      }
    });

    // Convert map to array and sort by start_time (timestamp)
    const getTimes = Array.from(timeSlotMap.values()).sort((a, b) => {
      return parseInt(a.start_time) - parseInt(b.start_time);
    });

    // Get default get_time (latest time slot)
    const defaultGetTime =
      getTimes.length > 0 ? getTimes[getTimes.length - 1].start_time : null;

    console.log(`✅ [Server] Found ${getTimes.length} time slots`);

    res.json({
      success: true,
      data: {
        get_times: getTimes,
        default_get_time: defaultGetTime,
      },
    });
  } catch (error) {
    console.error("❌ [Server] Error fetching times:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch time slots",
    });
  }
});

// Helper function to fetch all products from API and filter by time slot
async function fetchAllProductsFromAPI() {
  console.log("🔄 [Server] Fetching all products from API...");

  const response = await fetch(API_BASE_DEALXK, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${response.statusText}`);
  }

  const products = await response.json();

  if (!Array.isArray(products)) {
    throw new Error("API returned invalid data format");
  }

  console.log(`✅ [Server] Fetched ${products.length} products from API`);

  return products;
}

// Helper function to map product from new format to old format
function mapProductToOldFormat(product) {
  // Extract image ID from URL
  let imageId = "";
  if (product.img) {
    // Handle different URL formats
    const imgUrl = product.img;
    if (imgUrl.includes("/file/")) {
      imageId = imgUrl.split("/file/")[1] || "";
      // Remove any query parameters
      if (imageId.includes("?")) {
        imageId = imageId.split("?")[0];
      }
    } else if (imgUrl.includes("shopee.vn")) {
      // Try to extract from shopee.vn URLs
      const match = imgUrl.match(/file\/([^/?]+)/);
      if (match) {
        imageId = match[1];
      }
    }
  }

  return {
    name: product.title || "",
    price: String(product.price || 0),
    price_before_discount: String(product.original_price || product.price || 0),
    image: imageId,
    link: product.link || "",
    discount: product.percent || 0,
    stock: product.amount || 0,
    sold: product.sold || 0,
    rating_star: 0, // Not available in new API
    shop_location: "", // Not available in new API
    shop_id: product.shopid || 0,
    item_id: product.itemid || 0,
    start_time: String(product.sale_time || ""),
    // Keep original data for reference
    _original: product,
  };
}

// Helper function to clear products for a time slot
function clearProductsForTimeSlot(timeSlot) {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM products WHERE time_slot = ?", [timeSlot], (err) => {
      if (err) {
        console.error("Error clearing products:", err);
        reject(err);
      } else {
        console.log(
          `🗑️ [Server] Cleared old products for time slot ${timeSlot}`
        );
        resolve();
      }
    });
  });
}

// Helper function to save products to database
function saveProductsToDB(timeSlot, products) {
  return new Promise((resolve, reject) => {
    if (!products || products.length === 0) {
      resolve(0);
      return;
    }

    // Insert new products (using link as unique identifier)
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO products (time_slot, product_data) VALUES (?, ?)"
    );

    let inserted = 0;
    let completed = 0;

    products.forEach((product) => {
      const productJson = JSON.stringify(product);
      stmt.run([timeSlot, productJson], function (err) {
        if (err) {
          console.error("Error inserting product:", err);
        } else {
          inserted++;
        }
        completed++;
        if (completed === products.length) {
          stmt.finalize();
          resolve(inserted);
        }
      });
    });
  });
}

// API: Get products from external flashsale API (with pagination)
app.get("/api/products", async (req, res) => {
  try {
    const {
      get_time,
      sort_by = "discount",
      rating_filter = "all",
      query = "",
      fs = "false",
      force_reload = "false",
    } = req.query;

    // Build API parameters
    const getTime = get_time || "";

    if (!getTime) {
      res.status(400).json({
        success: false,
        error: "get_time is required",
      });
      return;
    }

    const shouldForceReload = force_reload === "true" || force_reload === "1";

    // Helper function to fetch and filter products by time slot
    const fetchProductsForTimeSlot = async () => {
      console.log(`🔄 [Server] Fetching products for time slot ${getTime}...`);

      // Clear old products for this time slot before fetching
      await clearProductsForTimeSlot(getTime);

      // Fetch all products from API
      const allProductsRaw = await fetchAllProductsFromAPI();

      // Filter products by time slot (sale_time)
      const filteredProducts = allProductsRaw.filter((product) => {
        if (!product.sale_time) return false;
        const productTimeSlot = String(product.sale_time);
        return productTimeSlot === getTime;
      });

      console.log(
        `✅ [Server] Filtered ${filteredProducts.length} products for time slot ${getTime} from ${allProductsRaw.length} total products`
      );

      // Map products to old format
      const mappedProducts = filteredProducts.map(mapProductToOldFormat);

      // Save to database
      await saveProductsToDB(getTime, mappedProducts);

      // Get get_times from API
      const timeSlotMap = new Map();
      allProductsRaw.forEach((product) => {
        if (product.sale_time) {
          const timeSlot = String(product.sale_time);
          if (!timeSlotMap.has(timeSlot)) {
            const date = new Date(product.sale_time * 1000);
            const vietnamTimeMs = date.getTime() + 7 * 60 * 60 * 1000;
            const vietnamDate = new Date(vietnamTimeMs);

            const hours = String(vietnamDate.getUTCHours()).padStart(2, "0");
            const minutes = String(vietnamDate.getUTCMinutes()).padStart(
              2,
              "0"
            );
            const day = String(vietnamDate.getUTCDate()).padStart(2, "0");
            const month = String(vietnamDate.getUTCMonth() + 1).padStart(
              2,
              "0"
            );

            const displayTime = `${hours}:${minutes} | ${day}/${month}`;

            timeSlotMap.set(timeSlot, {
              start_time: timeSlot,
              real_time: displayTime,
            });
          }
        }
      });

      const getTimes = Array.from(timeSlotMap.values()).sort((a, b) => {
        return parseInt(a.start_time) - parseInt(b.start_time);
      });

      const defaultGetTime =
        getTimes.length > 0 ? getTimes[getTimes.length - 1].start_time : null;

      console.log(
        `✅ [Server] Returning ${mappedProducts.length} products for time slot ${getTime}`
      );

      return {
        products: mappedProducts,
        get_times: getTimes,
        default_get_time: defaultGetTime,
      };
    };

    // Check if products already exist in DB for this time slot (unless force reload)
    if (!shouldForceReload) {
      db.all(
        "SELECT product_data FROM products WHERE time_slot = ?",
        [getTime],
        async (err, rows) => {
          if (err) {
            console.error("Error checking DB for products:", err);
            // Continue to fetch from API
            const result = await fetchProductsForTimeSlot();
            res.json({
              success: true,
              data: {
                products: result.products,
                get_times: result.get_times,
                default_get_time: result.default_get_time,
                has_more: false,
                from_cache: false,
              },
            });
          } else if (rows && rows.length > 0) {
            // Products exist in DB, return them
            console.log(
              `✅ [Server] Found ${rows.length} products in DB for time slot ${getTime}`
            );
            const products = rows.map((row) => JSON.parse(row.product_data));

            // Get get_times from API
            try {
              const allProductsRaw = await fetchAllProductsFromAPI();
              const timeSlotMap = new Map();
              allProductsRaw.forEach((product) => {
                if (product.sale_time) {
                  const timeSlot = String(product.sale_time);
                  if (!timeSlotMap.has(timeSlot)) {
                    const date = new Date(product.sale_time * 1000);
                    const vietnamTimeMs = date.getTime() + 7 * 60 * 60 * 1000;
                    const vietnamDate = new Date(vietnamTimeMs);

                    const hours = String(vietnamDate.getUTCHours()).padStart(
                      2,
                      "0"
                    );
                    const minutes = String(
                      vietnamDate.getUTCMinutes()
                    ).padStart(2, "0");
                    const day = String(vietnamDate.getUTCDate()).padStart(
                      2,
                      "0"
                    );
                    const month = String(
                      vietnamDate.getUTCMonth() + 1
                    ).padStart(2, "0");

                    const displayTime = `${hours}:${minutes} | ${day}/${month}`;

                    timeSlotMap.set(timeSlot, {
                      start_time: timeSlot,
                      real_time: displayTime,
                    });
                  }
                }
              });

              const getTimes = Array.from(timeSlotMap.values()).sort((a, b) => {
                return parseInt(a.start_time) - parseInt(b.start_time);
              });

              const defaultGetTime =
                getTimes.length > 0
                  ? getTimes[getTimes.length - 1].start_time
                  : null;

              res.json({
                success: true,
                data: {
                  products: products,
                  get_times: getTimes,
                  default_get_time: defaultGetTime,
                  has_more: false,
                  from_cache: true,
                },
              });
            } catch (error) {
              console.error("Error fetching get_times:", error);
              // Return products from DB anyway
              res.json({
                success: true,
                data: {
                  products: products,
                  get_times: [],
                  default_get_time: null,
                  has_more: false,
                  from_cache: true,
                },
              });
            }
          } else {
            // Products not in DB, fetch from API
            const result = await fetchProductsForTimeSlot();
            res.json({
              success: true,
              data: {
                products: result.products,
                get_times: result.get_times,
                default_get_time: result.default_get_time,
                has_more: false,
                from_cache: false,
              },
            });
          }
        }
      );
    } else {
      // Force reload: fetch from API
      const result = await fetchProductsForTimeSlot();
      res.json({
        success: true,
        data: {
          products: result.products,
          get_times: result.get_times,
          default_get_time: result.default_get_time,
          has_more: false,
          from_cache: false,
        },
      });
    }
  } catch (error) {
    console.error("❌ [Server] Error fetching products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch products",
    });
  }
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
