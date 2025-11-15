// Global variables
let currentPage = 1;
let currentLimit = 100;
let currentTime = "";
let currentSearch = "";
let allProducts = [];
let filteredProducts = [];
let totalProducts = 0;
let affId = "";
let activePriceFilter = "";
let linkMappingCache = {}; // Cache for affiliate links: { originalLink: { longLink, timestamp, date } }
let lastScanTime = null; // Last time we scanned for new links
let scanInterval = null; // Interval for auto-scanning

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  // Get aff_id from URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  affId = urlParams.get("aff_id") || "";

  // Load cached link mappings
  loadLinkMappingCache();

  // Check system status first
  checkSystemStatus().then((isActive) => {
    if (isActive) {
      // System is active, proceed with normal initialization
      // Load time buttons first, then it will auto-trigger loadProducts
      loadTimeButtons();
      // Don't call loadProducts() here because loadTimeButtons will trigger it
    } else {
      // System is in maintenance, show maintenance message
      showMaintenanceMessage();
    }
  });

  // Start auto-scan every 5 minutes
  startAutoScan();

  // Event listeners
  // Add event listener for search input (if exists)
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", handleSearchInput);
    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    });
  }

  // Add event listener for search button (if exists)
  const searchBtn = document.getElementById("searchBtn");
  if (searchBtn) {
    searchBtn.addEventListener("click", handleSearch);
  }

  // Add event listener for time select
  const timeSelect = document.getElementById("timeSelect");
  if (timeSelect) {
    timeSelect.addEventListener("change", handleTimeChange);
    console.log("Time select event listener attached");
  } else {
    console.error("timeSelect element not found!");
  }

  // Add event listener for refresh button
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      currentPage = 1;
      currentSearch = "";
      activePriceFilter = "";
      if (searchInput) {
        searchInput.value = "";
      }
      document.querySelectorAll(".price-filter-btn").forEach((btn) => {
        btn.classList.remove("active");
      });
      // Reload time buttons to get latest from API
      await loadTimeButtons();
      // Reload products
      await loadProducts(true);
    });
  } else {
    console.error("refreshBtn element not found!");
  }

  // Price filter buttons
  document.querySelectorAll(".price-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.getAttribute("data-filter");
      if (activePriceFilter === filter) {
        activePriceFilter = "";
        btn.classList.remove("active");
      } else {
        activePriceFilter = filter;
        document
          .querySelectorAll(".price-filter-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      }
      applyFilters();
      renderProducts();
      renderPagination();
    });
  });
});

// Load time buttons from API and map with DB data
async function loadTimeButtons() {
  try {
    // Get time slots from API
    const response = await fetch("https://linhkaadz.com/api/time-buttons");
    const data = await response.json();

    if (data.success && data.data && data.data.length > 0) {
      // Get time slots that have data in DB
      let dbTimeSlots = [];
      try {
        const dbResponse = await fetch(`${API_BASE_URL}/time-slots`);
        if (dbResponse.ok) {
          const dbData = await dbResponse.json();
          if (dbData.success && dbData.data) {
            dbTimeSlots = dbData.data;
          }
        }
      } catch (e) {
        console.log("Could not load time slots from DB:", e);
      }

      // Sort by order
      const timeButtons = data.data.sort(
        (a, b) => (a.order || 0) - (b.order || 0)
      );

      // Get list of time slots from API
      const apiTimeSlots = timeButtons.map((tb) => tb.time);

      // Find time slots in DB but not in API (need to be deleted)
      const timeSlotsToDelete = dbTimeSlots.filter(
        (timeSlot) => !apiTimeSlots.includes(timeSlot)
      );

      // Clean up time slots that no longer exist in API
      if (timeSlotsToDelete.length > 0) {
        console.log(
          `Cleaning up ${timeSlotsToDelete.length} time slots that no longer exist in API:`,
          timeSlotsToDelete
        );
        await cleanupTimeSlots(timeSlotsToDelete);
      }

      // Render time select
      const select = document.getElementById("timeSelect");
      const previousValue = select.value; // Save current selection
      select.innerHTML = '<option value="">Tất cả khung giờ</option>';

      timeButtons.forEach((timeBtn) => {
        const option = document.createElement("option");
        option.value = timeBtn.time;
        // Mark if has data in DB
        const hasData = dbTimeSlots.includes(timeBtn.time);
        option.textContent = hasData
          ? `${timeBtn.label || timeBtn.name} ✓`
          : timeBtn.label || timeBtn.name;
        select.appendChild(option);
      });

      // Restore previous selection if it still exists, otherwise auto-select
      if (
        previousValue &&
        timeButtons.find((tb) => tb.time === previousValue)
      ) {
        currentTime = previousValue;
        select.value = currentTime;
        // Trigger change event to load products
        setTimeout(() => {
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }, 100);
      } else {
        // Auto-select first active time slot
        const activeTime = timeButtons.find((tb) => tb.isActive);
        if (activeTime) {
          currentTime = activeTime.time;
          select.value = currentTime;
          // Trigger change event to load products
          setTimeout(() => {
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }, 100);
        } else if (timeButtons.length > 0) {
          currentTime = timeButtons[0].time;
          select.value = currentTime;
          // Trigger change event to load products
          setTimeout(() => {
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }, 100);
        } else {
          // No time slot selected, load all products
          currentTime = "";
          select.value = "";
          setTimeout(() => {
            loadProducts(true);
          }, 100);
        }
      }
    }
  } catch (error) {
    console.error("Error loading time buttons:", error);
  }
}

// Load products from API or DB
async function loadProducts(forceReloadData = false) {
  showLoading(true);
  hideEmptyState();

  try {
    let productsFromDB = null;
    let hasDataInDB = false;

    // If time is selected, try to load from DB first
    if (currentTime) {
      try {
        // Force reload if requested (when time changes)
        const allData = await loadAllDataFromJSON(forceReloadData);
        console.log("DB data check:", {
          hasAllData: !!allData,
          hasTimeSlot: allData ? !!allData[currentTime] : false,
          timeSlot: currentTime,
        });

        if (
          allData &&
          allData[currentTime] &&
          allData[currentTime].productCache
        ) {
          const productCache = allData[currentTime].productCache;
          if (
            productCache &&
            typeof productCache === "object" &&
            Object.keys(productCache).length > 0
          ) {
            // Convert productCache object to array
            productsFromDB = Object.values(productCache);
            hasDataInDB = true;
            console.log(
              `✅ Loaded ${productsFromDB.length} products from DB for ${currentTime}`
            );
          } else {
            console.log(
              `⚠️ DB has entry for ${currentTime} but productCache is empty`
            );
          }
        } else {
          console.log(`ℹ️ No DB entry for ${currentTime}, will fetch from API`);
        }
      } catch (e) {
        console.log(
          `❌ Error checking DB for ${currentTime}, will use API:`,
          e
        );
      }
    }

    // If no data from DB or DB has no products, use API to get full data
    if (!hasDataInDB || !productsFromDB || productsFromDB.length === 0) {
      console.log(
        `🔄 No data in DB for "${currentTime || "all"}", fetching from API...`
      );

      // Build API URL
      let apiUrl = `https://linhkaadz.com/api/aff-shopee/products?page=1&limit=10000`;

      // Add time filter if selected
      if (currentTime) {
        apiUrl += `&time=${encodeURIComponent(currentTime)}`;
      }

      console.log(`📡 Calling API: ${apiUrl}`);

      try {
        const response = await fetch(apiUrl);

        if (!response.ok) {
          throw new Error(
            `API returned ${response.status}: ${response.statusText}`
          );
        }

        const data = await response.json();
        console.log("API response:", {
          success: data.success,
          hasData: !!data.data,
          isArray: Array.isArray(data.data),
          dataLength: Array.isArray(data.data) ? data.data.length : 0,
        });

        if (
          data.success &&
          data.data &&
          Array.isArray(data.data) &&
          data.data.length > 0
        ) {
          allProducts = data.data;
          totalProducts = data.total || allProducts.length;
          console.log(
            `✅ Loaded ${allProducts.length} products from API for ${
              currentTime || "all time slots"
            }`
          );
        } else {
          console.warn(
            `⚠️ API returned no products for ${currentTime || "all"}`
          );
          allProducts = [];
          filteredProducts = [];
          showEmptyState();
          showLoading(false);
          return;
        }
      } catch (apiError) {
        console.error(`❌ API Error for ${currentTime}:`, apiError);
        allProducts = [];
        filteredProducts = [];
        showEmptyState();
        showLoading(false);
        return;
      }
    } else {
      // Use products from DB
      allProducts = productsFromDB;
      totalProducts = allProducts.length;
      console.log(
        `✅ Using ${allProducts.length} products from DB for ${currentTime}`
      );
    }

    // Apply filters
    applyFilters();

    // Convert to affiliate links after loading
    setTimeout(() => {
      convertProductsToAffiliateLinks(allProducts);
    }, 1000); // Wait 1 second after render
  } catch (error) {
    console.error("❌ Error loading products:", error);
    allProducts = [];
    filteredProducts = [];
    showEmptyState();
  } finally {
    showLoading(false);
    renderProducts();
    renderPagination();
  }
}

// Handle time select change
async function handleTimeChange(e) {
  const newTime = e.target ? e.target.value : e;

  console.log("handleTimeChange called with:", newTime);

  // Clear old data immediately
  allProducts = [];
  filteredProducts = [];
  currentPage = 1;
  adminDataCache = null;

  // Clear UI immediately
  const container = document.getElementById("productsContainer");
  if (container) {
    container.innerHTML = "";
  }
  const pagination = document.getElementById("pagination");
  if (pagination) {
    pagination.classList.add("hidden");
  }
  const resultsInfo = document.getElementById("resultsInfo");
  if (resultsInfo) {
    resultsInfo.textContent = "";
    resultsInfo.style.display = "none";
  }

  // Update current time
  currentTime = newTime;

  console.log("Loading products for time:", currentTime);

  // Reload products with force reload to get fresh data
  await loadProducts(true);
}

// Apply search and other filters
function applyFilters() {
  filteredProducts = [...allProducts];

  // Apply search filter
  if (currentSearch.trim()) {
    const searchLower = currentSearch.toLowerCase();
    filteredProducts = filteredProducts.filter((product) =>
      product.title.toLowerCase().includes(searchLower)
    );
  }

  // Apply price filters
  if (activePriceFilter) {
    filteredProducts = filteredProducts.filter((product) => {
      const price = parseFloat(product.price) || 0;
      const discount = product.percent || 0;
      const stock = product.amount || 0;

      switch (activePriceFilter) {
        case "price_1k":
          return price <= 1000;
        case "price_9k":
          return price >= 9000 && price <= 9999;
        case "price_29k":
          return price <= 29000;
        case "discount_90":
          return discount >= 90;
        case "stock_100":
          return stock >= 100;
        default:
          return true;
      }
    });
  }

  // Reset to first page when filtering
  currentPage = 1;
}

// Handle search input
function handleSearchInput(e) {
  // Real-time search (optional)
}

// Handle search button click
function handleSearch() {
  currentSearch = document.getElementById("searchInput").value.trim();
  applyFilters();
  renderProducts();
  renderPagination();
}

// Render products
function renderProducts() {
  const container = document.getElementById("productsContainer");

  // Update results info
  updateResultsInfo();

  if (filteredProducts.length === 0) {
    showEmptyState();
    container.innerHTML = "";
    return;
  }

  hideEmptyState();

  // Calculate pagination
  const startIndex = (currentPage - 1) * currentLimit;
  const endIndex = startIndex + currentLimit;
  const productsToShow = filteredProducts.slice(startIndex, endIndex);

  container.innerHTML = productsToShow
    .map((product) => createProductCard(product))
    .join("");

  // Add click handlers to product cards
  productsToShow.forEach((product, index) => {
    const card = container.children[index];
    if (card) {
      const link = card.getAttribute("data-link");
      card.addEventListener("click", async () => {
        await openProductLink(link);
      });
    }
  });
}

// Update results info
function updateResultsInfo() {
  const resultsInfo = document.getElementById("resultsInfo");
  if (filteredProducts.length > 0) {
    const startIndex = (currentPage - 1) * currentLimit + 1;
    const endIndex = Math.min(
      currentPage * currentLimit,
      filteredProducts.length
    );
    resultsInfo.textContent = `Hiển thị ${startIndex}-${endIndex} trong tổng số ${
      filteredProducts.length
    } sản phẩm${currentSearch ? ` cho "${currentSearch}"` : ""}`;
    resultsInfo.style.display = "block";
  } else {
    resultsInfo.textContent = "";
    resultsInfo.style.display = "none";
  }
}

// Create product card HTML
function createProductCard(product) {
  const discountPercent = product.percent || 0;
  const formattedPrice = formatPrice(product.price);
  const formattedOriginalPrice = formatPrice(product.original_price);
  const hasAffiliateLink = linkMappingCache[product.link] ? true : false;

  return `
        <div class="product-card" data-link="${escapeHtml(product.link)}">
            <div class="product-image-wrapper">
                <img src="${escapeHtml(product.img)}" alt="${escapeHtml(
    product.title
  )}" class="product-image" 
                     onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'">
                <div class="discount-badge-overlay">-${discountPercent}%</div>
                <div class="flash-sale-badge">⚡ FLASH SALE</div>
                ${
                  hasAffiliateLink
                    ? '<div class="affiliate-badge">🔗 Affiliate</div>'
                    : ""
                }
            </div>
            <div class="product-info">
                <h3 class="product-title">${escapeHtml(product.title)}</h3>
                <div class="product-price-section">
                    <div class="price-row">
                        <span class="current-price">${formattedPrice}₫</span>
                        <span class="original-price">${formattedOriginalPrice}₫</span>
                    </div>
                </div>
                <div class="product-meta">
                    <span class="amount-badge">Số lượng: ${
                      product.amount || 0
                    }</span>
                </div>
            </div>
        </div>
    `;
}

// Load link mapping cache from localStorage
function loadLinkMappingCache() {
  try {
    const cached = localStorage.getItem("shopeeLinkMapping");
    if (cached) {
      const data = JSON.parse(cached);
      const today = new Date().toDateString();

      // Clear old cache from previous days
      linkMappingCache = {};
      Object.keys(data).forEach((key) => {
        if (data[key].date === today) {
          linkMappingCache[key] = data[key];
        }
      });

      // Save cleaned cache
      saveLinkMappingCache();
    }
  } catch (e) {
    console.error("Error loading link mapping cache:", e);
    linkMappingCache = {};
  }
}

// Save link mapping cache to localStorage
function saveLinkMappingCache() {
  try {
    localStorage.setItem("shopeeLinkMapping", JSON.stringify(linkMappingCache));
  } catch (e) {
    console.error("Error saving link mapping cache:", e);
  }
}

// Get affiliate link from cache or return original
function getAffiliateLink(originalLink) {
  if (linkMappingCache[originalLink]) {
    return linkMappingCache[originalLink].longLink;
  }
  return null; // Return null if not cached, will use original link
}

// Convert products to affiliate links (batch processing)
async function convertProductsToAffiliateLinks(products) {
  const cookies = getShopeeCookies();
  if (!cookies || Object.keys(cookies).length === 0) {
    console.warn("⚠️ No Shopee cookies found. Please login at login.html");
    return;
  }

  // Filter products that need conversion
  const productsToConvert = products.filter((p) => {
    const link = p.link || "";
    return link.includes("shopee.vn/product/") && !linkMappingCache[link];
  });

  if (productsToConvert.length === 0) {
    console.log("✅ All products already have affiliate links cached");
    return; // All products already cached
  }

  try {
    // Extract product IDs
    const productIds = productsToConvert
      .map((p) => {
        const match = (p.link || "").match(/product\/(\d+)\/(\d+)/);
        if (match) {
          return {
            shopId: match[1],
            itemId: match[2],
            originalLink: p.link,
          };
        }
        return null;
      })
      .filter(Boolean);

    if (productIds.length === 0) {
      console.warn("⚠️ No valid product IDs found to convert");
      return;
    }

    console.log(
      `🔄 Converting ${productIds.length} products to affiliate links...`
    );

    // Process in batches of 50 (API might have limits)
    const batchSize = 50;
    let convertedCount = 0;

    for (let i = 0; i < productIds.length; i += batchSize) {
      const batch = productIds.slice(i, i + batchSize);

      try {
        // Call batchCustomLink API
        const affiliateLinks = await callBatchCustomLinkAPI(batch, cookies);

        // Update cache
        affiliateLinks.forEach((result, index) => {
          if (result && result.longLink && batch[index]) {
            const originalLink = batch[index].originalLink;
            linkMappingCache[originalLink] = {
              longLink: result.longLink,
              shortLink: result.shortLink,
              timestamp: new Date().toISOString(),
              date: new Date().toDateString(),
            };
            convertedCount++;
          }
        });

        // Save cache after each batch
        saveLinkMappingCache();

        // Re-render products with new affiliate links
        renderProducts();

        console.log(
          `✅ Converted batch ${
            Math.floor(i / batchSize) + 1
          }: ${convertedCount}/${productIds.length} products`
        );

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < productIds.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(
          `❌ Error converting batch ${Math.floor(i / batchSize) + 1}:`,
          error
        );
        // Continue with next batch even if one fails
      }
    }

    console.log(
      `✅ Conversion complete: ${convertedCount}/${productIds.length} products converted`
    );
  } catch (error) {
    console.error("❌ Error converting to affiliate links:", error);
  }
}

// Get Shopee cookies from localStorage
function getShopeeCookies() {
  try {
    const cookies = localStorage.getItem("shopeeCookies");
    if (cookies) {
      return JSON.parse(cookies);
    }
  } catch (e) {
    console.error("Error getting cookies:", e);
  }
  return null;
}

// Call Shopee Affiliate batchCustomLink API
async function callBatchCustomLinkAPI(productIds, cookies) {
  // Build cookie string
  const cookieString = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");

  // Get CSRF token from cookies
  const csrfToken = cookies["csrftoken"] || "";

  // Build request body - Shopee uses specific format
  const requestBody = {
    query:
      "mutation batchCustomLink($input: BatchCustomLinkInput!) { batchCustomLink(input: $input) { shortLink longLink failCode } }",
    variables: {
      input: {
        links: productIds.map((p) => ({
          shopId: parseInt(p.shopId),
          itemId: parseInt(p.itemId),
        })),
      },
    },
  };

  try {
    const response = await fetch(
      "https://affiliate.shopee.vn/api/v3/gql?q=batchCustomLink",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          Cookie: cookieString,
          "Csrf-Token": csrfToken,
          Origin: "https://affiliate.shopee.vn",
          Referer: "https://affiliate.shopee.vn/offer/custom_link",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        },
        credentials: "include",
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API Error Response:", errorText);
      throw new Error(
        `API returned ${response.status}: ${errorText.substring(0, 100)}`
      );
    }

    const data = await response.json();

    if (data.data && data.data.batchCustomLink) {
      return data.data.batchCustomLink;
    }

    if (data.errors) {
      throw new Error("API Error: " + JSON.stringify(data.errors));
    }

    throw new Error(
      "Invalid API response: " + JSON.stringify(data).substring(0, 200)
    );
  } catch (error) {
    console.error("Error calling batchCustomLink API:", error);
    throw error;
  }
}

// Start auto-scan every 5 minutes
function startAutoScan() {
  // Clear old interval if exists
  if (scanInterval) {
    clearInterval(scanInterval);
  }

  // Scan immediately on load
  scanForNewLinks();

  // Then scan every 5 minutes
  scanInterval = setInterval(() => {
    scanForNewLinks();
  }, 5 * 60 * 1000); // 5 minutes
}

// Scan for new links that need conversion
async function scanForNewLinks() {
  if (allProducts.length === 0) return;

  console.log("🔍 Scanning for new links to convert...");

  // Check which products need conversion
  const needsConversion = allProducts.filter((p) => {
    const link = p.link || "";
    return link.includes("shopee.vn/product/") && !linkMappingCache[link];
  });

  if (needsConversion.length > 0) {
    console.log(`Found ${needsConversion.length} new products to convert`);
    await convertProductsToAffiliateLinks(needsConversion);
  } else {
    console.log("✅ All products already have affiliate links");
  }
}

// Global variable to cache data
let adminDataCache = null;
const CACHE_DURATION = 60000; // 1 minute cache
const API_BASE_URL = "http://buichung.vn/api"; // Node.js API base URL

// Load all data from API
async function loadAllDataFromJSON(forceReload = false) {
  try {
    // Check cache first (unless force reload)
    if (!forceReload) {
      const now = Date.now();
      if (adminDataCache && now - adminDataCache.time < CACHE_DURATION) {
        return adminDataCache.data;
      }
    }

    // Load from API
    const response = await fetch(`${API_BASE_URL}/data?t=${Date.now()}`);

    if (response.ok) {
      const data = await response.json();

      // Cache it
      const now = Date.now();
      adminDataCache = {
        data: data,
        time: now,
      };

      return data;
    }
  } catch (e) {
    console.log("Could not load data from API:", e);
  }

  return null;
}

// Load time slot data from all data
async function loadTimeSlotDataFromJSON(timeSlot, forceReload = false) {
  try {
    // Load all data from data.json
    const allData = await loadAllDataFromJSON(forceReload);

    if (allData && allData[timeSlot]) {
      return allData[timeSlot];
    }
  } catch (e) {
    console.error("Error loading time slot data:", e);
  }

  return null;
}

// Get conversion link from admin (if available)
async function getAdminConversionLink(originalLink) {
  try {
    // If we have currentTime, load data for that time slot
    if (currentTime) {
      const timeSlotData = await loadTimeSlotDataFromJSON(currentTime, false);
      if (
        timeSlotData &&
        timeSlotData.linkMapping &&
        timeSlotData.linkMapping[originalLink]
      ) {
        return timeSlotData.linkMapping[originalLink];
      }
    }

    // Fallback: check all time slots (less efficient but works)
    // This is for backward compatibility
    const adminMapping = localStorage.getItem("adminLinkMapping");
    if (adminMapping) {
      const mapping = JSON.parse(adminMapping);
      return mapping[originalLink] || null;
    }
  } catch (e) {
    console.error("Error loading admin link mapping:", e);
  }
  return null;
}

// Open product link
async function openProductLink(link) {
  // Priority 1: Check admin conversion link first
  let productLink = await getAdminConversionLink(link);

  // Priority 2: Check cache for affiliate link
  if (!productLink) {
    productLink = getAffiliateLink(link) || link;
  }

  // If no cached affiliate link and have affId, add aff_id parameter
  // (only if we're using original link, not admin conversion link)
  if (!productLink || productLink === link) {
    if (!linkMappingCache[link] && affId) {
      try {
        const url = new URL(productLink);
        url.searchParams.set("aff_id", affId);
        productLink = url.toString();
      } catch (e) {
        // Fallback for relative URLs
        const separator = productLink.includes("?") ? "&" : "?";
        productLink = `${productLink}${separator}aff_id=${encodeURIComponent(
          affId
        )}`;
      }
    }
  }

  window.open(productLink, "_blank");
}

// Render pagination
function renderPagination() {
  const pagination = document.getElementById("pagination");
  const totalPages = Math.ceil(filteredProducts.length / currentLimit);

  if (totalPages <= 1) {
    pagination.classList.add("hidden");
    return;
  }

  pagination.classList.remove("hidden");

  let html = "";

  // Previous button
  html += `
        <button onclick="goToPage(${currentPage - 1})" ${
    currentPage === 1 ? "disabled" : ""
  }>
            ← Trước
        </button>
    `;

  // Page numbers
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  if (startPage > 1) {
    html += `<button onclick="goToPage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span class="pagination-info">...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `
            <button onclick="goToPage(${i})" class="${
      i === currentPage ? "active" : ""
    }">
                ${i}
            </button>
        `;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<span class="pagination-info">...</span>`;
    }
    html += `<button onclick="goToPage(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  html += `
        <button onclick="goToPage(${currentPage + 1})" ${
    currentPage === totalPages ? "disabled" : ""
  }>
            Sau →
        </button>
    `;

  pagination.innerHTML = html;
}

// Go to specific page
function goToPage(page) {
  const totalPages = Math.ceil(filteredProducts.length / currentLimit);
  if (page >= 1 && page <= totalPages) {
    currentPage = page;
    renderProducts();
    renderPagination();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

// Format price
function formatPrice(price) {
  const numPrice = typeof price === "string" ? parseFloat(price) : price;
  return new Intl.NumberFormat("vi-VN").format(numPrice);
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Show/hide loading
function showLoading(show) {
  const loading = document.getElementById("loading");
  if (show) {
    loading.classList.remove("hidden");
  } else {
    loading.classList.add("hidden");
  }
}

// Show/hide empty state
function showEmptyState() {
  document.getElementById("emptyState").classList.remove("hidden");
}

function hideEmptyState() {
  document.getElementById("emptyState").classList.add("hidden");
}

// Check system status
async function checkSystemStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/system-status`);
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        return data.isActive;
      }
    }
    // Default to active if check fails
    return true;
  } catch (error) {
    console.error("Error checking system status:", error);
    // Default to active if check fails
    return true;
  }
}

// Show maintenance message
function showMaintenanceMessage() {
  const maintenanceMsg = document.getElementById("maintenanceMessage");
  const groupLinksSection = document.querySelector(".group-links-section");
  const timeSelection = document.querySelector(".time-selection-section");
  const priceFilter = document.querySelector(".price-filter-section");
  const searchSection = document.querySelector(".search-section");
  const productsContainer = document.getElementById("productsContainer");
  const pagination = document.getElementById("pagination");

  // Show maintenance message
  if (maintenanceMsg) {
    maintenanceMsg.classList.remove("hidden");
  }

  // Hide all other sections
  if (groupLinksSection) groupLinksSection.style.display = "none";
  if (timeSelection) timeSelection.style.display = "none";
  if (priceFilter) priceFilter.style.display = "none";
  if (searchSection) searchSection.style.display = "none";
  if (productsContainer) productsContainer.style.display = "none";
  if (pagination) pagination.style.display = "none";
}

// Hide maintenance message
function hideMaintenanceMessage() {
  const maintenanceMsg = document.getElementById("maintenanceMessage");
  const groupLinksSection = document.querySelector(".group-links-section");
  const timeSelection = document.querySelector(".time-selection-section");
  const priceFilter = document.querySelector(".price-filter-section");
  const searchSection = document.querySelector(".search-section");
  const productsContainer = document.getElementById("productsContainer");
  const pagination = document.getElementById("pagination");

  // Hide maintenance message
  if (maintenanceMsg) {
    maintenanceMsg.classList.add("hidden");
  }

  // Show all other sections
  if (groupLinksSection) groupLinksSection.style.display = "";
  if (timeSelection) timeSelection.style.display = "";
  if (priceFilter) priceFilter.style.display = "";
  if (searchSection) searchSection.style.display = "";
  if (productsContainer) productsContainer.style.display = "";
  if (pagination) pagination.style.display = "";
}

// Clean up time slots that no longer exist in API
async function cleanupTimeSlots(timeSlotsToDelete) {
  try {
    for (const timeSlot of timeSlotsToDelete) {
      try {
        const response = await fetch(
          `${API_BASE_URL}/data/${encodeURIComponent(timeSlot)}`,
          {
            method: "DELETE",
          }
        );

        if (response.ok) {
          console.log(`✅ Deleted time slot: ${timeSlot}`);
        } else {
          console.warn(`⚠️ Failed to delete time slot: ${timeSlot}`);
        }
      } catch (error) {
        console.error(`❌ Error deleting time slot ${timeSlot}:`, error);
      }
    }

    if (timeSlotsToDelete.length > 0) {
      console.log(
        `✅ Cleanup completed: ${timeSlotsToDelete.length} time slots removed from DB`
      );
    }
  } catch (error) {
    console.error("❌ Error during cleanup:", error);
  }
}
