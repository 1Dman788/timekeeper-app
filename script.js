/*
 * Timekeeper Web Application
 *
 * This file provides all of the client‑side logic for the Timekeeper demo app.
 * Because GitHub Pages only supports static content, the app stores data in
 * the browser's localStorage to simulate a backend. In a production setup
 * you would replace the storage helpers below with calls to a real database
 * such as Firebase, Supabase or a serverless function.
 */

// Utility functions for localStorage persistence
const Storage = {
    get(key, defaultValue) {
        const raw = localStorage.getItem(key);
        if (!raw) return defaultValue;
        try {
            return JSON.parse(raw);
        } catch (e) {
            console.warn('Error parsing', key, e);
            return defaultValue;
        }
    },
    set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
};

// Initialize default admin account and settings if not already present
function initDefaults() {
    let accounts = Storage.get('accounts', null);
    if (!accounts) {
        accounts = [];
        // default admin account with username 'admin' and password 'admin'
        accounts.push({ username: 'admin', password: 'admin', role: 'admin' });
        Storage.set('accounts', accounts);
    }
    let settings = Storage.get('paySettings', null);
    if (!settings) {
        settings = { startDays: [1, 15] };
        Storage.set('paySettings', settings);
    }
    let logs = Storage.get('logs', null);
    if (!logs) {
        Storage.set('logs', []);
    }
    // current punch for each user stored separately
    let currentPunch = Storage.get('currentPunch', null);
    if (!currentPunch) {
        Storage.set('currentPunch', {});
    }
}

// Time helper: convert HH:MM string to minutes after midnight
function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}
// Convert minutes to HH:MM string (zero padded)
function minutesToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Compute pay period start date given a Date object and settings
function getPayPeriodStart(dateObj) {
    const settings = Storage.get('paySettings', { startDays: [1, 15] });
    const startDays = settings.startDays.slice().sort((a, b) => a - b);
    const day = dateObj.getDate();
    const month = dateObj.getMonth();
    const year = dateObj.getFullYear();
    let chosenDay = null;
    for (let i = 0; i < startDays.length; i++) {
        if (day >= startDays[i]) {
            chosenDay = startDays[i];
        }
    }
    if (chosenDay === null) {
        // use last start day of previous month
        const prevMonth = (month - 1 + 12) % 12;
        const prevYear = month === 0 ? year - 1 : year;
        const lastDay = startDays[startDays.length - 1];
        const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
        const startDate = new Date(prevYear, prevMonth, Math.min(lastDay, daysInPrevMonth));
        return startDate.toISOString().slice(0, 10);
    } else {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const actualDay = Math.min(chosenDay, daysInMonth);
        const startDate = new Date(year, month, actualDay);
        return startDate.toISOString().slice(0, 10);
    }
}

// Compute worked minutes given scheduled shift and actual times
function computeWorkedMinutes(scheduledStart, scheduledEnd, actualIn, actualOut) {
    const ss = timeToMinutes(scheduledStart);
    const se = timeToMinutes(scheduledEnd);
    const ai = timeToMinutes(actualIn);
    const ao = timeToMinutes(actualOut);
    let deduction = 0;
    if (ai > ss) {
        deduction = ai - ss;
    }
    const effectiveEnd = Math.min(ao, se);
    let minutes = effectiveEnd - ss - deduction;
    if (minutes < 0) minutes = 0;
    return minutes;
}

// Format minutes into hours with two decimal places
function formatHours(mins) {
    return (mins / 60).toFixed(2);
}

// Update UI helper functions
function show(element) { element.classList.remove('hidden'); }
function hide(element) { element.classList.add('hidden'); }

// Populate employees table in admin view
function refreshEmployeeTable() {
    const tbody = document.querySelector('#employees-table tbody');
    tbody.innerHTML = '';
    const accounts = Storage.get('accounts', []);
    accounts.forEach((acc, index) => {
        if (acc.role === 'employee') {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${acc.username}</td>
                <td>${acc.hourlyRate ?? ''}</td>
                <td>${acc.shiftStart ?? ''}</td>
                <td>${acc.shiftEnd ?? ''}</td>
                <td>
                    <button class="delete-btn" data-index="${index}">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });
    // attach delete handlers
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const idx = parseInt(this.dataset.index);
            const accs = Storage.get('accounts', []);
            const user = accs[idx];
            if (user && confirm(`Delete employee '${user.username}'? This will remove all their logs.`)) {
                // Remove logs
                let logs = Storage.get('logs', []);
                logs = logs.filter(log => log.username !== user.username);
                Storage.set('logs', logs);
                // Remove account
                accs.splice(idx, 1);
                Storage.set('accounts', accs);
                refreshEmployeeTable();
                refreshLogsTable();
            }
        });
    });
}

// Populate logs table (admin view)
function refreshLogsTable() {
    const tbody = document.querySelector('#logs-table tbody');
    tbody.innerHTML = '';
    const logs = Storage.get('logs', []);
    logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${log.username}</td>
            <td>${log.date}</td>
            <td>${log.punchIn}</td>
            <td>${log.punchOut}</td>
            <td>${formatHours(log.minutesWorked)}</td>
            <td>${log.payPeriodStart}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Generate summary for admin view
function generateSummary() {
    const logs = Storage.get('logs', []);
    const accounts = Storage.get('accounts', []);
    // Build a map payPeriodStart -> employee -> totalMinutes
    const summaryMap = {};
    logs.forEach(log => {
        if (!summaryMap[log.payPeriodStart]) summaryMap[log.payPeriodStart] = {};
        const empMap = summaryMap[log.payPeriodStart];
        if (!empMap[log.username]) empMap[log.username] = 0;
        empMap[log.username] += log.minutesWorked;
    });
    // Create rows
    const summaryRows = [];
    Object.keys(summaryMap).sort().forEach(period => {
        const empMap = summaryMap[period];
        Object.keys(empMap).forEach(user => {
            const totalMins = empMap[user];
            const account = accounts.find(a => a.username === user);
            const rate = account?.hourlyRate || 0;
            const totalPay = (totalMins / 60 * rate).toFixed(2);
            summaryRows.push({ period, user, totalHours: formatHours(totalMins), totalPay });
        });
    });
    return summaryRows;
}

// Populate summary table and show export button
function refreshSummaryTable() {
    const tbody = document.querySelector('#summary-table tbody');
    tbody.innerHTML = '';
    const rows = generateSummary();
    rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.period}</td>
            <td>${row.user}</td>
            <td>${row.totalHours}</td>
            <td>${row.totalPay}</td>
        `;
        tbody.appendChild(tr);
    });
    const summaryTable = document.querySelector('#summary-table');
    const exportBtn = document.querySelector('#export-summary-button');
    if (rows.length > 0) {
        show(summaryTable);
        show(exportBtn);
    } else {
        hide(summaryTable);
        hide(exportBtn);
    }
}

// Export summary to CSV and download
function exportSummary() {
    const rows = generateSummary();
    if (rows.length === 0) {
        alert('No summary data to export.');
        return;
    }
    let csv = 'Pay Period Start,Employee,Total Hours,Total Pay\n';
    rows.forEach(r => {
        csv += `${r.period},${r.user},${r.totalHours},${r.totalPay}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'timekeeper_summary.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
}

// Populate employee's history table
function refreshHistoryTable(username) {
    const tbody = document.querySelector('#history-table tbody');
    tbody.innerHTML = '';
    const logs = Storage.get('logs', []);
    logs.filter(log => log.username === username).forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${log.date}</td>
            <td>${log.punchIn}</td>
            <td>${log.punchOut}</td>
            <td>${formatHours(log.minutesWorked)}</td>
            <td>${log.payPeriodStart}</td>
        `;
        tbody.appendChild(tr);
    });
}

// DOMContentLoaded – start everything
document.addEventListener('DOMContentLoaded', () => {
    initDefaults();
    // Grab references to DOM elements
    const loginSection = document.getElementById('login-section');
    const employeeSection = document.getElementById('employee-section');
    const adminSection = document.getElementById('admin-section');
    const loginButton = document.getElementById('login-button');
    const loginError = document.getElementById('login-error');
    const loginUsername = document.getElementById('login-username');
    const loginPassword = document.getElementById('login-password');
    const loginRole = document.getElementById('login-role');

    // Employee view elements
    const employeeWelcome = document.getElementById('employee-welcome');
    const shiftInfo = document.getElementById('shift-info');
    const punchInBtn = document.getElementById('punch-in-button');
    const punchOutBtn = document.getElementById('punch-out-button');
    const punchMessage = document.getElementById('punch-message');
    const viewHistoryBtn = document.getElementById('view-history-button');
    const historySection = document.getElementById('history-section');
    const employeeLogoutBtn = document.getElementById('employee-logout-button');

    // Admin view elements
    const adminLogoutBtn = document.getElementById('admin-logout-button');
    const addEmployeeBtn = document.getElementById('add-employee-button');
    const addEmployeeError = document.getElementById('add-employee-error');
    const newEmpUsername = document.getElementById('new-emp-username');
    const newEmpPassword = document.getElementById('new-emp-password');
    const newEmpRate = document.getElementById('new-emp-rate');
    const newEmpShiftStart = document.getElementById('new-emp-shift-start');
    const newEmpShiftEnd = document.getElementById('new-emp-shift-end');
    const payPeriodDaysInput = document.getElementById('pay-period-days');
    const savePayPeriodBtn = document.getElementById('save-pay-period');
    const payPeriodMessage = document.getElementById('pay-period-message');
    const generateSummaryBtn = document.getElementById('generate-summary-button');
    const exportSummaryBtn = document.getElementById('export-summary-button');

    let currentUser = null;

    // Display correct view after login
    function loadEmployeeView(account) {
        currentUser = account;
        loginSection.classList.add('hidden');
        adminSection.classList.add('hidden');
        employeeSection.classList.remove('hidden');
        employeeWelcome.textContent = `Welcome, ${account.username}!`;
        // Display shift schedule
        const start = account.shiftStart || '09:00';
        const end = account.shiftEnd || '17:00';
        shiftInfo.textContent = `Your shift is scheduled from ${start} to ${end}.`;
        // Determine if currentPunch exists for this user
        const currentPunch = Storage.get('currentPunch', {});
        const today = new Date().toISOString().slice(0, 10);
        if (currentPunch[account.username] && currentPunch[account.username].date === today) {
            // Already punched in
            hide(punchInBtn);
            show(punchOutBtn);
            const time = currentPunch[account.username].punchIn;
            punchMessage.textContent = `You punched in at ${time}.`; 
        } else {
            // Not punched in yet
            show(punchInBtn);
            hide(punchOutBtn);
            punchMessage.textContent = '';
        }
        hide(historySection);
    }

    function loadAdminView(account) {
        currentUser = account;
        loginSection.classList.add('hidden');
        employeeSection.classList.add('hidden');
        adminSection.classList.remove('hidden');
        // Populate existing settings
        const settings = Storage.get('paySettings', { startDays: [1, 15] });
        payPeriodDaysInput.value = settings.startDays.join(',');
        // Refresh tables
        refreshEmployeeTable();
        refreshLogsTable();
        hide(document.getElementById('summary-table'));
        hide(document.getElementById('export-summary-button'));
    }

    // Handle login
    loginButton.addEventListener('click', () => {
        const username = loginUsername.value.trim();
        const password = loginPassword.value;
        const role = loginRole.value;
        const accounts = Storage.get('accounts', []);
        const account = accounts.find(acc => acc.username === username && acc.password === password && acc.role === role);
        if (!account) {
            loginError.textContent = 'Invalid credentials or role.';
            return;
        }
        loginError.textContent = '';
        if (account.role === 'employee') {
            loadEmployeeView(account);
        } else if (account.role === 'admin') {
            loadAdminView(account);
        }
        // Clear login fields
        loginUsername.value = '';
        loginPassword.value = '';
    });

    // Employee punch in
    punchInBtn.addEventListener('click', () => {
        const now = new Date();
        const timeStr = now.toTimeString().slice(0, 5);
        const today = now.toISOString().slice(0, 10);
        const currentPunch = Storage.get('currentPunch', {});
        currentPunch[currentUser.username] = { date: today, punchIn: timeStr };
        Storage.set('currentPunch', currentPunch);
        hide(punchInBtn);
        show(punchOutBtn);
        punchMessage.textContent = `You punched in at ${timeStr}.`;
    });

    // Employee punch out
    punchOutBtn.addEventListener('click', () => {
        const now = new Date();
        const timeOutStr = now.toTimeString().slice(0, 5);
        const today = now.toISOString().slice(0, 10);
        const currentPunch = Storage.get('currentPunch', {});
        const punchRecord = currentPunch[currentUser.username];
        if (!punchRecord || punchRecord.date !== today) {
            alert('No punch in record found for today.');
            return;
        }
        const timeInStr = punchRecord.punchIn;
        // Compute worked minutes using scheduled shift and actual times
        const account = currentUser;
        const scheduledStart = account.shiftStart || '09:00';
        const scheduledEnd = account.shiftEnd || '17:00';
        const minutesWorked = computeWorkedMinutes(scheduledStart, scheduledEnd, timeInStr, timeOutStr);
        // Determine pay period start
        const payPeriodStart = getPayPeriodStart(now);
        // Save log
        const logs = Storage.get('logs', []);
        logs.push({
            username: account.username,
            date: today,
            punchIn: timeInStr,
            punchOut: timeOutStr,
            minutesWorked,
            payPeriodStart
        });
        Storage.set('logs', logs);
        // Remove current punch
        delete currentPunch[currentUser.username];
        Storage.set('currentPunch', currentPunch);
        // Update UI
        show(punchInBtn);
        hide(punchOutBtn);
        punchMessage.textContent = `You punched out at ${timeOutStr}. Total worked: ${formatHours(minutesWorked)} hours.`;
    });

    // View history
    viewHistoryBtn.addEventListener('click', () => {
        if (historySection.classList.contains('hidden')) {
            refreshHistoryTable(currentUser.username);
            show(historySection);
            viewHistoryBtn.textContent = 'Hide History';
        } else {
            hide(historySection);
            viewHistoryBtn.textContent = 'View History';
        }
    });

    // Employee logout
    employeeLogoutBtn.addEventListener('click', () => {
        currentUser = null;
        hide(employeeSection);
        show(loginSection);
        historySection.classList.add('hidden');
        viewHistoryBtn.textContent = 'View History';
    });

    // Admin logout
    adminLogoutBtn.addEventListener('click', () => {
        currentUser = null;
        hide(adminSection);
        show(loginSection);
    });

    // Add employee
    addEmployeeBtn.addEventListener('click', () => {
        const username = newEmpUsername.value.trim();
        const password = newEmpPassword.value;
        const rate = parseFloat(newEmpRate.value);
        const shiftStart = newEmpShiftStart.value;
        const shiftEnd = newEmpShiftEnd.value;
        if (!username || !password || !shiftStart || !shiftEnd || isNaN(rate)) {
            addEmployeeError.textContent = 'Please fill in all fields and provide valid values.';
            return;
        }
        const accounts = Storage.get('accounts', []);
        if (accounts.some(acc => acc.username === username)) {
            addEmployeeError.textContent = 'Username already exists.';
            return;
        }
        accounts.push({ username, password, role: 'employee', hourlyRate: rate, shiftStart, shiftEnd });
        Storage.set('accounts', accounts);
        // clear inputs
        newEmpUsername.value = '';
        newEmpPassword.value = '';
        newEmpRate.value = '';
        newEmpShiftStart.value = '';
        newEmpShiftEnd.value = '';
        addEmployeeError.textContent = '';
        refreshEmployeeTable();
    });

    // Save pay period settings
    savePayPeriodBtn.addEventListener('click', () => {
        const input = payPeriodDaysInput.value.trim();
        const parts = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 31);
        if (parts.length === 0) {
            payPeriodMessage.textContent = 'Please enter valid day numbers separated by commas.';
            return;
        }
        parts.sort((a, b) => a - b);
        Storage.set('paySettings', { startDays: parts });
        payPeriodMessage.textContent = 'Pay period settings saved.';
    });

    // Generate summary button
    generateSummaryBtn.addEventListener('click', () => {
        refreshSummaryTable();
    });

    // Export summary
    exportSummaryBtn.addEventListener('click', () => {
        exportSummary();
    });
});