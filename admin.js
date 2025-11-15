// Admin page global variables
let timeButtons = [];
let productsData = [];
let currentTimeSlot = ""; // Current selected time slot
let currentTimeSlotData = null; // Current time slot data: { linkMapping: {}, subIdMapping: {}, reasonMapping: {}, productCache: {} }
let allTimeSlotData = {}; // All data: { "time": { linkMapping: {}, subIdMapping: {}, reasonMapping: {}, productCache: {} } }
// const API_BASE_URL = "http://localhost:3000/api"; // Node.js API base URL
const API_BASE_URL = "https://buichung.vn/api"; // Node.js API base URL
let isUpdatingSystemStatus = false; // Flag to prevent multiple simultaneous updates

// Initialize on page load
document.addEventListener("DOMContentLoaded", async () => {
  // Load data from data.json first
  await loadDataFromJSON();

  // Load time buttons
  await loadTimeButtons();

  // Load system status
  await loadSystemStatus();

  // Event listeners
  document
    .getElementById("timeSelectAdmin")
    .addEventListener("change", handleTimeSlotChange);
  document
    .getElementById("clearTimeBtn")
    .addEventListener("click", handleClearTimeSlot);
  document
    .getElementById("downloadBtn")
    .addEventListener("click", handleDownloadExcel);
  document.getElementById("uploadBtn").addEventListener("click", () => {
    document.getElementById("uploadFile").click();
  });
  document
    .getElementById("uploadFile")
    .addEventListener("change", handleUploadExcel);
  document
    .getElementById("clearAllBtn")
    .addEventListener("click", handleClearAll);
  document
    .getElementById("systemStatusToggle")
    .addEventListener("change", handleSystemStatusChange);
});

// Load system status
async function loadSystemStatus() {
  try {
    const toggle = document.getElementById("systemStatusToggle");
    const statusText = document.getElementById("systemStatusText");

    // Disable toggle while loading
    if (toggle) toggle.disabled = true;
    if (statusText) statusText.textContent = "Đang tải...";

    const response = await fetch(`${API_BASE_URL}/system-status`);
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        if (toggle) {
          toggle.checked = data.isActive;
          toggle.disabled = false;
        }
        if (statusText) {
          statusText.textContent = data.isActive ? "Hoạt động" : "Bảo trì";
          statusText.className = data.isActive
            ? "system-status-text active"
            : "system-status-text maintenance";
        }
      } else {
        if (toggle) toggle.disabled = false;
        if (statusText) statusText.textContent = "Lỗi tải trạng thái";
      }
    } else {
      if (toggle) toggle.disabled = false;
      if (statusText) statusText.textContent = "Lỗi tải trạng thái";
    }
  } catch (error) {
    console.error("Error loading system status:", error);
    const toggle = document.getElementById("systemStatusToggle");
    const statusText = document.getElementById("systemStatusText");
    if (toggle) toggle.disabled = false;
    if (statusText) statusText.textContent = "Lỗi tải trạng thái";
  }
}

// Handle system status change
async function handleSystemStatusChange(e) {
  // Prevent multiple simultaneous updates
  if (isUpdatingSystemStatus) {
    e.preventDefault();
    return;
  }

  const isActive = e.target.checked;
  const toggle = e.target;
  const statusText = document.getElementById("systemStatusText");

  // Disable toggle during update
  isUpdatingSystemStatus = true;
  toggle.disabled = true;

  if (statusText) {
    statusText.textContent = "Đang cập nhật...";
    statusText.className = "system-status-text";
  }

  try {
    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(`${API_BASE_URL}/system-status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isActive: isActive }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        if (statusText) {
          statusText.textContent = isActive ? "Hoạt động" : "Bảo trì";
          statusText.className = isActive
            ? "system-status-text active"
            : "system-status-text maintenance";
        }
        console.log(
          `✅ System status updated to: ${isActive ? "Active" : "Maintenance"}`
        );
        // Show success message without alert (less intrusive)
        // alert(`Hệ thống đã ${isActive ? "bật" : "tắt"} thành công!`);
      } else {
        // Revert toggle if update failed
        toggle.checked = !isActive;
        if (statusText) {
          statusText.textContent = "Lỗi cập nhật";
          statusText.className = "system-status-text";
        }
        alert("Lỗi khi cập nhật trạng thái hệ thống");
      }
    } else {
      // Revert toggle if update failed
      toggle.checked = !isActive;
      if (statusText) {
        statusText.textContent = "Lỗi cập nhật";
        statusText.className = "system-status-text";
      }
      alert("Lỗi khi cập nhật trạng thái hệ thống");
    }
  } catch (error) {
    console.error("Error updating system status:", error);

    // Revert toggle if update failed
    toggle.checked = !isActive;

    if (statusText) {
      if (error.name === "AbortError") {
        statusText.textContent = "Timeout - Vui lòng thử lại";
      } else {
        statusText.textContent = "Lỗi cập nhật";
      }
      statusText.className = "system-status-text";
    }

    alert(
      "Lỗi khi cập nhật trạng thái hệ thống: " +
        (error.name === "AbortError" ? "Timeout" : error.message)
    );
  } finally {
    // Re-enable toggle after update completes
    isUpdatingSystemStatus = false;
    toggle.disabled = false;
  }
}

// Load time buttons from API
async function loadTimeButtons() {
  try {
    const response = await fetch("https://linhkaadz.com/api/time-buttons");
    const data = await response.json();

    if (data.success && data.data && data.data.length > 0) {
      timeButtons = data.data.sort((a, b) => (a.order || 0) - (b.order || 0));

      // Get list of time slots from API
      const apiTimeSlots = timeButtons.map((tb) => tb.time);

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

      const select = document.getElementById("timeSelectAdmin");
      select.innerHTML = '<option value="">Chọn khung giờ</option>';

      timeButtons.forEach((timeBtn) => {
        const option = document.createElement("option");
        option.value = timeBtn.time;
        option.textContent = timeBtn.label || timeBtn.name;
        select.appendChild(option);
      });
    }
  } catch (error) {
    console.error("Error loading time buttons:", error);
    alert("Lỗi khi tải danh sách khung giờ: " + error.message);
  }
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
      alert(
        `Đã xóa ${timeSlotsToDelete.length} khung giờ không còn tồn tại trong hệ thống khỏi database.`
      );
    }
  } catch (error) {
    console.error("❌ Error during cleanup:", error);
  }
}

// Handle time slot change
async function handleTimeSlotChange(e) {
  const selectedTime = e.target.value;
  if (!selectedTime) {
    productsData = [];
    currentTimeSlotData = null;
    fillProductsTable();
    updateProductCount();
    return;
  }

  currentTimeSlot = selectedTime;

  // Load mapping data from API for this time slot
  await loadTimeSlotDataFromJSON(selectedTime);

  // Load products from API
  await loadProductsForTimeSlot(selectedTime);
}

// Load data from API
async function loadDataFromJSON() {
  try {
    const response = await fetch(`${API_BASE_URL}/data`);
    if (response.ok) {
      const data = await response.json();
      if (data && typeof data === "object") {
        allTimeSlotData = data;
        console.log("Data loaded from API:", allTimeSlotData);
      }
    }
  } catch (e) {
    console.log("API not available or empty, starting with empty data:", e);
    allTimeSlotData = {};
  }
}

// Load time slot data from API
async function loadTimeSlotDataFromJSON(timeSlot) {
  try {
    // Try to load from API first
    const response = await fetch(
      `${API_BASE_URL}/data/${encodeURIComponent(timeSlot)}`
    );
    if (response.ok) {
      const data = await response.json();
      currentTimeSlotData = data;
      // Also update allTimeSlotData
      allTimeSlotData[timeSlot] = data;
      console.log(`Data loaded for ${timeSlot} from API:`, currentTimeSlotData);
      return;
    }
  } catch (e) {
    console.log(
      `Could not load data for ${timeSlot} from API, using local data`
    );
  }

  // Fallback to local data
  if (allTimeSlotData[timeSlot]) {
    currentTimeSlotData = allTimeSlotData[timeSlot];
    console.log(`Data loaded for ${timeSlot} from local:`, currentTimeSlotData);
  } else {
    // Initialize empty data if not exists
    currentTimeSlotData = {
      linkMapping: {},
      subIdMapping: {},
      reasonMapping: {},
      productCache: {},
    };
  }
}

// Load products for specific time slot
async function loadProductsForTimeSlot(timeSlot) {
  showLoading(true);

  try {
    // Build API URL with time filter
    const apiUrl = `https://linhkaadz.com/api/aff-shopee/products?page=1&limit=10000&time=${encodeURIComponent(
      timeSlot
    )}`;

    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.success && data.data && Array.isArray(data.data)) {
      productsData = data.data;

      // Initialize time slot data if not exists
      if (!currentTimeSlotData) {
        currentTimeSlotData = {
          linkMapping: {},
          subIdMapping: {},
          reasonMapping: {},
          productCache: {},
        };
      }

      // Cache product data (update cache with latest from API)
      productsData.forEach((product) => {
        if (product.link) {
          currentTimeSlotData.productCache[product.link] = product;
        }
      });

      // Update allTimeSlotData with current time slot data
      allTimeSlotData[timeSlot] = currentTimeSlotData;

      // Update product count
      updateProductCount();

      // Fill table with products and existing mappings
      fillProductsTable(currentTimeSlotData);
    } else {
      productsData = [];
      alert("Không có dữ liệu sản phẩm cho khung giờ này");
    }
  } catch (error) {
    console.error("Error loading products:", error);
    alert("Lỗi khi tải sản phẩm: " + error.message);
    productsData = [];
  } finally {
    showLoading(false);
  }
}

// Handle clear time slot button click
async function handleClearTimeSlot() {
  const timeSelect = document.getElementById("timeSelectAdmin");
  const selectedTime = timeSelect.value;

  if (!selectedTime) {
    alert("Vui lòng chọn khung giờ trước khi clear");
    return;
  }

  if (
    !confirm(
      `Bạn có chắc muốn xóa dữ liệu đã map của khung giờ "${selectedTime}"?`
    )
  ) {
    return;
  }

  try {
    // Delete from database
    const response = await fetch(
      `${API_BASE_URL}/data/${encodeURIComponent(selectedTime)}`,
      {
        method: "DELETE",
      }
    );

    if (response.ok) {
      // Clear local data
      allTimeSlotData[selectedTime] = {
        linkMapping: {},
        subIdMapping: {},
        reasonMapping: {},
        productCache: {},
      };

      currentTimeSlotData = allTimeSlotData[selectedTime];

      // Reload products from API
      await loadProductsForTimeSlot(selectedTime);

      alert(`Đã xóa dữ liệu đã map của khung giờ "${selectedTime}".`);
    } else {
      alert("Lỗi khi xóa dữ liệu từ database");
    }
  } catch (e) {
    console.error("Error clearing time slot:", e);
    alert("Lỗi khi xóa dữ liệu: " + e.message);
  }
}

// Handle clear all button click
async function handleClearAll() {
  if (!confirm("Bạn có chắc muốn xóa TẤT CẢ dữ liệu trong database?")) {
    return;
  }

  try {
    // Delete all from database
    const response = await fetch(`${API_BASE_URL}/data`, {
      method: "DELETE",
    });

    if (response.ok) {
      // Clear local data
      allTimeSlotData = {};
      currentTimeSlotData = null;

      // Clear current display
      productsData = [];
      fillProductsTable();
      updateProductCount();

      alert(`Đã xóa tất cả dữ liệu từ database.`);
    } else {
      alert("Lỗi khi xóa dữ liệu từ database");
    }
  } catch (e) {
    console.error("Error clearing all data:", e);
    alert("Lỗi khi xóa dữ liệu: " + e.message);
  }
}

// Fill products table
function fillProductsTable(timeSlotData = null) {
  const tbody = document.getElementById("productsTableBody");

  if (productsData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-table">Chưa có dữ liệu. Vui lòng chọn khung giờ</td>
      </tr>
    `;
    return;
  }

  // Use current time slot data if not provided
  if (!timeSlotData) {
    timeSlotData = currentTimeSlotData || {
      linkMapping: {},
      subIdMapping: {},
      reasonMapping: {},
      productCache: {},
    };
  }

  const linkMapping = timeSlotData.linkMapping || {};
  const subIdMapping = timeSlotData.subIdMapping || {};
  const reasonMapping = timeSlotData.reasonMapping || {};

  tbody.innerHTML = productsData
    .map((product, index) => {
      const originalLink = product.link || "";
      const conversionLink = linkMapping[originalLink] || "";
      const subIds = subIdMapping[originalLink] || {
        sub1: "",
        sub2: "",
        sub3: "",
        sub4: "",
        sub5: "",
      };
      const reason = reasonMapping[originalLink] || "";

      return `
        <tr data-index="${index}" data-original-link="${escapeHtml(
        originalLink
      )}">
          <td class="link-cell">
            <input type="text" 
                   value="${escapeHtml(originalLink)}" 
                   readonly 
                   class="original-link-input"
                   data-link="${escapeHtml(originalLink)}">
          </td>
          <td class="subid-cell">
            <input type="text" 
                   class="subid-input" 
                   data-subid="1"
                   data-original-link="${escapeHtml(originalLink)}"
                   value="${escapeHtml(subIds.sub1 || "")}"
                   placeholder="Sub_id1">
          </td>
          <td class="subid-cell">
            <input type="text" 
                   class="subid-input" 
                   data-subid="2"
                   data-original-link="${escapeHtml(originalLink)}"
                   value="${escapeHtml(subIds.sub2 || "")}"
                   placeholder="Sub_id2">
          </td>
          <td class="subid-cell">
            <input type="text" 
                   class="subid-input" 
                   data-subid="3"
                   data-original-link="${escapeHtml(originalLink)}"
                   value="${escapeHtml(subIds.sub3 || "")}"
                   placeholder="Sub_id3">
          </td>
          <td class="subid-cell">
            <input type="text" 
                   class="subid-input" 
                   data-subid="4"
                   data-original-link="${escapeHtml(originalLink)}"
                   value="${escapeHtml(subIds.sub4 || "")}"
                   placeholder="Sub_id4">
          </td>
          <td class="subid-cell">
            <input type="text" 
                   class="subid-input" 
                   data-subid="5"
                   data-original-link="${escapeHtml(originalLink)}"
                   value="${escapeHtml(subIds.sub5 || "")}"
                   placeholder="Sub_id5">
          </td>
          <td class="conversion-link-cell">
            <input type="text" 
                   class="conversion-link-input" 
                   value="${escapeHtml(conversionLink)}"
                   placeholder="Nhập liên kết chuyển đổi"
                   data-original-link="${escapeHtml(originalLink)}">
          </td>
          <td class="reason-cell">
            <select class="reason-select" data-original-link="${escapeHtml(
              originalLink
            )}">
              <option value="">-- Chọn --</option>
              <option value="Thành công" ${
                reason === "Thành công" ? "selected" : ""
              }>Thành công</option>
              <option value="Link không hợp lệ" ${
                reason === "Link không hợp lệ" ? "selected" : ""
              }>Link không hợp lệ</option>
              <option value="Sản phẩm hết hàng" ${
                reason === "Sản phẩm hết hàng" ? "selected" : ""
              }>Sản phẩm hết hàng</option>
              <option value="Link bị lỗi" ${
                reason === "Link bị lỗi" ? "selected" : ""
              }>Link bị lỗi</option>
              <option value="Khác" ${
                reason === "Khác" ? "selected" : ""
              }>Khác</option>
            </select>
          </td>
        </tr>
      `;
    })
    .join("");

  // Add event listeners for conversion link inputs
  tbody.querySelectorAll(".conversion-link-input").forEach((input) => {
    input.addEventListener("change", handleConversionLinkChange);
    input.addEventListener("blur", handleConversionLinkChange);
  });

  // Add event listeners for Sub_id inputs
  tbody.querySelectorAll(".subid-input").forEach((input) => {
    input.addEventListener("change", handleSubIdChange);
    input.addEventListener("blur", handleSubIdChange);
  });

  // Add event listeners for reason selects
  tbody.querySelectorAll(".reason-select").forEach((select) => {
    select.addEventListener("change", handleReasonChange);
  });
}

// Handle conversion link change
function handleConversionLinkChange(e) {
  const input = e.target;
  const originalLink = input.getAttribute("data-original-link");
  const conversionLink = input.value.trim();

  if (originalLink && currentTimeSlot && currentTimeSlotData) {
    if (conversionLink) {
      currentTimeSlotData.linkMapping[originalLink] = conversionLink;
    } else {
      delete currentTimeSlotData.linkMapping[originalLink];
    }

    // Save to JSON file and auto download
    saveTimeSlotDataToJSON(true);
  }
}

// Handle Sub_id change
function handleSubIdChange(e) {
  const input = e.target;
  const originalLink = input.getAttribute("data-original-link");
  const subIdNum = input.getAttribute("data-subid");
  const value = input.value.trim();

  if (originalLink && subIdNum && currentTimeSlot && currentTimeSlotData) {
    if (!currentTimeSlotData.subIdMapping) {
      currentTimeSlotData.subIdMapping = {};
    }
    if (!currentTimeSlotData.subIdMapping[originalLink]) {
      currentTimeSlotData.subIdMapping[originalLink] = {
        sub1: "",
        sub2: "",
        sub3: "",
        sub4: "",
        sub5: "",
      };
    }
    currentTimeSlotData.subIdMapping[originalLink][`sub${subIdNum}`] = value;

    // Save to JSON file and auto download
    saveTimeSlotDataToJSON(true);
  }
}

// Handle reason change
function handleReasonChange(e) {
  const select = e.target;
  const originalLink = select.getAttribute("data-original-link");
  const reason = select.value;

  if (originalLink && currentTimeSlot && currentTimeSlotData) {
    if (reason) {
      currentTimeSlotData.reasonMapping[originalLink] = reason;
    } else {
      delete currentTimeSlotData.reasonMapping[originalLink];
    }

    // Save to JSON file and auto download
    saveTimeSlotDataToJSON(true);
  }
}

// Download Excel file
function handleDownloadExcel() {
  if (productsData.length === 0) {
    alert("Không có dữ liệu để tải xuống");
    return;
  }

  if (!currentTimeSlot) {
    alert("Vui lòng chọn khung giờ trước");
    return;
  }

  try {
    // Get current values from table inputs
    const tbody = document.getElementById("productsTableBody");
    const rows = tbody.querySelectorAll("tr[data-original-link]");

    const timeSlotData = currentTimeSlotData || {};
    const productCache = timeSlotData.productCache || {};

    // Prepare data for Excel - only export visible columns
    const excelData = Array.from(rows).map((row) => {
      const originalLink = row.getAttribute("data-original-link");
      const cachedProduct = productCache[originalLink] || {};

      // Get values from inputs
      const sub1Input = row.querySelector('.subid-input[data-subid="1"]');
      const sub2Input = row.querySelector('.subid-input[data-subid="2"]');
      const sub3Input = row.querySelector('.subid-input[data-subid="3"]');
      const sub4Input = row.querySelector('.subid-input[data-subid="4"]');
      const sub5Input = row.querySelector('.subid-input[data-subid="5"]');

      const sub1 = sub1Input ? sub1Input.value.trim() : "";
      const sub2 = sub2Input ? sub2Input.value.trim() : "";
      const sub3 = sub3Input ? sub3Input.value.trim() : "";
      const sub4 = sub4Input ? sub4Input.value.trim() : "";
      const sub5 = sub5Input ? sub5Input.value.trim() : "";

      return {
        "Liên kết gốc": originalLink,
        "Sub id1": sub1,
        "Sub id2": sub2,
        "Sub id3": sub3,
        "Sub id4": sub4,
        "Sub id5": sub5,
        // Store product data as JSON in a hidden column (we'll use it when loading back)
        _productData: JSON.stringify(cachedProduct),
      };
    });

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Set column widths - only for visible columns
    ws["!cols"] = [
      { wch: 50 }, // Liên kết gốc
      { wch: 15 }, // Sub id1
      { wch: 15 }, // Sub id2
      { wch: 15 }, // Sub id3
      { wch: 15 }, // Sub id4
      { wch: 15 }, // Sub id5
      { hidden: true }, // _productData (hidden)
    ];

    // Set font to Arial for all cells
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) continue;

        // Set cell style with Arial font
        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        if (!ws[cellAddress].s.font) ws[cellAddress].s.font = {};
        ws[cellAddress].s.font.name = "Arial";
        ws[cellAddress].s.font.sz = 11;
      }
    }

    // Set header row to bold with Arial
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: C });
      if (ws[cellAddress]) {
        if (!ws[cellAddress].s) ws[cellAddress].s = {};
        if (!ws[cellAddress].s.font) ws[cellAddress].s.font = {};
        ws[cellAddress].s.font.name = "Arial";
        ws[cellAddress].s.font.sz = 11;
        ws[cellAddress].s.font.bold = true;
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, "Sản phẩm");

    // Generate filename with timestamp
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5);
    const filename = `san-pham-${timestamp}.xlsx`;

    // Download
    XLSX.writeFile(wb, filename);
    alert("Đã tải xuống file Excel thành công!");
  } catch (error) {
    console.error("Error downloading Excel:", error);
    alert("Lỗi khi tải xuống Excel: " + error.message);
  }
}

// Handle upload Excel file
async function handleUploadExcel(e) {
  const file = e.target.files[0];
  if (!file) return;

  const timeSelect = document.getElementById("timeSelectAdmin");
  const selectedTime = timeSelect.value;

  if (!selectedTime) {
    alert("Vui lòng chọn khung giờ trước khi tải lên Excel");
    e.target.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      // Get first sheet
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        alert("File Excel không có dữ liệu");
        return;
      }

      // Initialize time slot data if not exists
      if (!currentTimeSlotData) {
        currentTimeSlotData = {
          linkMapping: {},
          subIdMapping: {},
          reasonMapping: {},
          productCache: {},
        };
      }

      const timeSlotData = currentTimeSlotData;

      // Process uploaded data
      jsonData.forEach((row) => {
        const originalLink = row["Liên kết gốc"] || "";
        const conversionLink = row["Liên kết chuyển đổi"] || "";
        // Support both "Sub_id1" (old format) and "Sub id1" (new format)
        const sub1 = row["Sub id1"] || row["Sub_id1"] || "";
        const sub2 = row["Sub id2"] || row["Sub_id2"] || "";
        const sub3 = row["Sub id3"] || row["Sub_id3"] || "";
        const sub4 = row["Sub id4"] || row["Sub_id4"] || "";
        const sub5 = row["Sub id5"] || row["Sub_id5"] || "";
        const reason = row["Lí do thất bại"] || "";

        if (originalLink) {
          // Restore product data from cache or from _productData column
          let productData = null;
          if (row["_productData"]) {
            try {
              productData = JSON.parse(row["_productData"]);
            } catch (e) {
              console.warn("Could not parse product data:", e);
            }
          }

          // Store product cache
          if (productData) {
            timeSlotData.productCache[originalLink] = productData;
          }

          // Store conversion link
          if (conversionLink) {
            timeSlotData.linkMapping[originalLink] = conversionLink;
          }

          // Store Sub_id mapping
          if (sub1 || sub2 || sub3 || sub4 || sub5) {
            timeSlotData.subIdMapping[originalLink] = {
              sub1: sub1,
              sub2: sub2,
              sub3: sub3,
              sub4: sub4,
              sub5: sub5,
            };
          }

          // Store reason mapping
          if (reason) {
            timeSlotData.reasonMapping[originalLink] = reason;
          }
        }
      });

      // Update currentTimeSlotData
      currentTimeSlotData = timeSlotData;

      // Reload products from API to merge with uploaded data
      await loadProductsForTimeSlot(selectedTime);

      // Save to database
      await saveTimeSlotDataToJSON();

      alert(
        `Đã tải lên ${jsonData.length} sản phẩm thành công cho khung giờ "${selectedTime}"! Dữ liệu đã được lưu vào database.`
      );
    } catch (error) {
      console.error("Error reading Excel file:", error);
      alert("Lỗi khi đọc file Excel: " + error.message);
    }
  };

  reader.readAsArrayBuffer(file);

  // Reset file input
  e.target.value = "";
}

// Update product count
function updateProductCount() {
  const countElement = document.getElementById("productCount");
  if (productsData.length > 0 && currentTimeSlot) {
    countElement.textContent = `Khung giờ: ${currentTimeSlot} - Tổng số sản phẩm: ${productsData.length}`;
  } else {
    countElement.textContent = "Chưa có dữ liệu";
  }
}

// Save time slot data to SQLite via API
async function saveTimeSlotDataToJSON() {
  if (!currentTimeSlot || !currentTimeSlotData) {
    return;
  }

  try {
    // Update allTimeSlotData with current time slot data
    allTimeSlotData[currentTimeSlot] = currentTimeSlotData;

    // Save to API
    const response = await fetch(`${API_BASE_URL}/data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeSlot: currentTimeSlot,
        data: currentTimeSlotData,
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`Data saved for ${currentTimeSlot} to database:`, result);
    } else {
      console.error("Failed to save data to API");
    }
  } catch (e) {
    console.error("Error saving data to API:", e);
  }
}

// Helper function to download JSON file
function downloadJSONFile(jsonString, fileName) {
  try {
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Error downloading JSON file:", e);
  }
}

// Handle download JSON button click (backup data)
function handleDownloadJSON() {
  try {
    // Update allTimeSlotData with current time slot data if exists
    if (currentTimeSlot && currentTimeSlotData) {
      allTimeSlotData[currentTimeSlot] = currentTimeSlotData;
    }

    const jsonString = JSON.stringify(allTimeSlotData, null, 2);

    // Download JSON file as backup
    downloadJSONFile(jsonString, "data-backup.json");

    alert(`Đã tải xuống file backup thành công!`);
  } catch (e) {
    console.error("Error downloading JSON:", e);
    alert("Lỗi khi tải xuống JSON: " + e.message);
  }
}

// Show/hide loading
function showLoading(show) {
  const loading = document.getElementById("loadingAdmin");
  if (show) {
    loading.classList.remove("hidden");
  } else {
    loading.classList.add("hidden");
  }
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Export function to get conversion link (for use in main page)
function getConversionLink(originalLink, timeSlot = null) {
  // If timeSlot is provided, use it; otherwise check all time slots
  if (timeSlot && allTimeSlotData[timeSlot]) {
    return allTimeSlotData[timeSlot].linkMapping[originalLink] || null;
  }

  // Check all time slots (for backward compatibility)
  for (const time in allTimeSlotData) {
    if (allTimeSlotData[time].linkMapping[originalLink]) {
      return allTimeSlotData[time].linkMapping[originalLink];
    }
  }
  return null;
}

// Make function available globally for main page
window.getAdminConversionLink = getConversionLink;
window.getAllTimeSlotData = () => allTimeSlotData;
