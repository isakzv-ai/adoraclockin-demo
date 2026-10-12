const STORAGE_KEY = 'clockwise-preview-v1';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SL_MONTHS = {januar:0,februar:1,marec:2,april:3,maj:4,junij:5,julij:6,avgust:7,september:8,oktober:9,november:10,december:11};
const $ = (selector) => document.querySelector(selector);
let appState;
let reviewOnly = false;
let toastTimer;

function id() { return globalThis.crypto?.randomUUID?.() || `shift-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function localDateTime(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return {date:`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`, time:`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`};
}
function parseCSV(text) {
  const rows=[]; let row=[], cell='', quoted=false;
  text=text.replace(/^\uFEFF/, '');
  for (let i=0;i<text.length;i++) {
    const char=text[i];
    if (quoted) {
      if (char==='"' && text[i+1]==='"') { cell+='"'; i++; }
      else if (char==='"') quoted=false;
      else cell+=char;
    } else if (char==='"') quoted=true;
    else if (char===',') { row.push(cell); cell=''; }
    else if (char==='\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row=[]; cell=''; }
    else cell+=char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}
function parseTime(value) {
  const text=String(value||'').trim();
  const match=text.match(/(?:(\d{1,2})\/(\d{1,2})\/(\d{4})\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return {time:'', embeddedDate:''};
  const embeddedDate=match[3] ? `${match[3]}-${String(match[2]).padStart(2,'0')}-${String(match[1]).padStart(2,'0')}` : '';
  return {time:`${String(match[4]).padStart(2,'0')}:${match[5]}:${match[6]||'00'}`,embeddedDate};
}
function parseCSVImport(text, filename='Employee timesheet.csv') {
  const rows=parseCSV(text);
  const headerIndex=rows.findIndex(row=>row.some(c=>c.trim().toLowerCase()==='mail') && row.some(c=>c.trim().toLowerCase()==='datum'));
  if (headerIndex<0) throw new Error('Could not find the timesheet columns (mail, datum, čas prihoda, čas odhoda).');
  const headers=rows[headerIndex].map(x=>x.trim().toLowerCase());
  const col={email:headers.indexOf('mail'),date:headers.indexOf('datum'),in:headers.findIndex(x=>x.includes('prihoda')),out:headers.findIndex(x=>x.includes('odhoda')),duration:headers.indexOf('skupaj')};
  const candidates=rows.slice(headerIndex+1).filter(r=>r[col.email]?.includes('@') && /^\d{4}-\d\d-\d\d$/.test((r[col.date]||'').trim()));
  if (!candidates.length) throw new Error('No dated employee shift rows were found.');
  const counts=new Map(); for (const r of candidates) counts.set(r[col.email].trim(),(counts.get(r[col.email].trim())||0)+1);
  const email=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
  const shifts=[], otherRows=[];
  for (const row of candidates) {
    const date=row[col.date].trim();
    if (row[col.email].trim()!==email) { otherRows.push({email:row[col.email].trim(),date}); continue; }
    const start=parseTime(row[col.in]), end=parseTime(row[col.out]);
    const notes=row.slice(col.duration+1).map(x=>x.trim()).filter(Boolean).join(' · ');
    const importedDuration=(row[col.duration]||'').trim();
    const mismatches=[start.embeddedDate && start.embeddedDate!==date, end.embeddedDate && end.embeddedDate!==date].filter(Boolean).length;
    shifts.push({id:id(),date,start:start.time,end:end.time,rawDate:row[col.date].trim(),rawStart:(row[col.in]||'').trim(),rawEnd:(row[col.out]||'').trim(),notes,importedDuration,source:'import',dateMismatch:mismatches,original:{date:row[col.date].trim(),start:(row[col.in]||'').trim(),end:(row[col.out]||'').trim(),notes,importedDuration}});
  }
  const targets={},reportedTotals={};
  for (const row of rows.slice(0,headerIndex)) {
    const month=SL_MONTHS[(row[10]||'').trim().toLowerCase()];
    if (month===undefined) continue;
    const target=Number((row[13]||'').trim()); if (Number.isFinite(target)&&target>0) targets[month]=target;
    if ((row[11]||'').trim()) reportedTotals[month]=row[11].trim();
  }
  const derivedName=filename.replace(/\.[^.]+$/,'').replace(/\s*[-–_]\s*Sheet\s*\d+$/i,'').replace(/[-_]+/g,' ').trim();
  return {employee:{id:id(),name:derivedName||'Employee',email,targets,reportedTotals,shifts},otherRows,totalRows:candidates.length};
}
function save() { localStorage.setItem(STORAGE_KEY,JSON.stringify(appState)); }
function formatDate(date) { return new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short'}).format(new Date(`${date}T12:00:00`)); }
function secs(time) { if (!time) return null; const [h,m,s='0']=time.split(':').map(Number); return h*3600+m*60+s; }
function durationSeconds(shift) { const a=secs(shift.start),b=secs(shift.end); return a===null||b===null||b<a ? 0 : b-a; }
function formatDuration(totalSeconds) { const hours=Math.floor(totalSeconds/3600),mins=Math.floor(totalSeconds%3600/60),seconds=totalSeconds%60; return `${hours}h ${String(mins).padStart(2,'0')}m${seconds?` ${String(seconds).padStart(2,'0')}s`:''}`; }
function monthShifts(employee,ym) { return employee.shifts.filter(s=>s.date.startsWith(ym)); }
function getIssues(shift) { const issues=[]; if (shift.dateMismatch) issues.push(`${shift.dateMismatch} imported timestamp date${shift.dateMismatch===1?'':'s'} differ`); if (shift.start&&!shift.end) issues.push('Missing clock-out'); if (shift.end&&!shift.start) issues.push('Missing clock-in'); if (shift.start&&shift.end&&durationSeconds(shift)===0) issues.push('Check time order'); if (shift.notes) issues.push('Note'); return issues; }
function currentEmployee() { return appState.employees.find(e=>e.id===appState.activeId)||appState.employees[0]; }
function monthChoices(employee) {
  const months=new Set([...employee.shifts.map(s=>s.date.slice(0,7)),...Object.keys(employee.targets).map(m=>`2026-${String(Number(m)+1).padStart(2,'0')}`),...Object.keys(employee.reportedTotals).map(m=>`2026-${String(Number(m)+1).padStart(2,'0')}`)]);
  return [...months].sort();
}
function escapeHTML(value) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function render() {
  const employee=currentEmployee(); if (!employee) return;
  $('#employeeName').textContent=employee.name.split(' ')[0]||employee.name;
  $('#employeeInitials').textContent=employee.name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
  const switchWrap=$('#employeeSwitchWrap'); switchWrap.hidden=appState.employees.length<2;
  if (!switchWrap.hidden) { const select=$('#employeeSelect'); const previous=select.value; select.innerHTML=appState.employees.map(e=>`<option value="${escapeHTML(e.id)}">${escapeHTML(e.name)}</option>`).join(''); select.value=appState.employees.some(e=>e.id===previous)?previous:employee.id; }
  const now=localDateTime(); const open=employee.shifts.find(s=>s.date===now.date&&!s.end);
  $('#statusIcon').classList.toggle('active',!!open);
  $('#clockStatus').textContent=open?'You’re clocked in':'You’re not clocked in';
  $('#clockDetail').textContent=open?`Started today at ${open.start?.slice(0,5)||'—'} · ${formatDate(open.date)}`:'Your workday hasn’t started yet.';
  $('#clockButton').classList.toggle('clock-out',!!open);
  $('.clock-button-icon').textContent=open?'↙':'↗';
  $('#clockButtonText').innerHTML=open?'Clock out <small>Odhod</small>':'Clock in <small>Prihod</small>';
  $('#clockHint').textContent=open?'Tap when you finish your shift.':'One tap records the current time.';
  const choices=monthChoices(employee); const monthSelect=$('#monthSelect');
  if (!choices.length) choices.push(now.date.slice(0,7));
  const oldMonth=monthSelect.value; monthSelect.innerHTML=choices.map(ym=>{const [y,m]=ym.split('-').map(Number);return `<option value="${ym}">${MONTHS[m-1]} ${y}</option>`}).join('');
  const defaultMonth=choices.includes(now.date.slice(0,7))?now.date.slice(0,7):choices[choices.length-1];
  monthSelect.value=choices.includes(oldMonth)?oldMonth:defaultMonth;
  renderMonth(employee,monthSelect.value);
  renderImportWarning();
}
function renderMonth(employee,ym) {
  const shifts=monthShifts(employee,ym).sort((a,b)=>b.date.localeCompare(a.date)||b.start.localeCompare(a.start));
  const visible=reviewOnly?shifts.filter(s=>getIssues(s).length):shifts;
  const total=shifts.reduce((sum,s)=>sum+durationSeconds(s),0);
  const [year,month]=ym.split('-').map(Number), target=employee.targets[month-1]||0;
  $('#workedValue').textContent=formatDuration(total);
  $('#targetValue').textContent=target?`${target}h`:'—';
  $('#shiftCount').textContent=String(shifts.filter(s=>s.start&&s.end).length);
  $('#shiftCaption').textContent=`Completed ${MONTHS[month-1]||''}`;
  const percent=target?Math.min(total/(target*3600)*100,100):0;
  $('#progressBar').style.width=`${percent}%`;
  $('#progressCaption').textContent=target?`${Math.round(percent)}% of monthly target`: 'Monthly target not set';
  const balance=total-target*3600, balanceNode=$('#balanceValue');
  balanceNode.classList.toggle('negative',balance<0);
  balanceNode.textContent=target?(balance>=0?`${formatDuration(balance)} above target`:`${formatDuration(Math.abs(balance))} below target`):'No target set';
  $('#sheetTotal').textContent=employee.reportedTotals[month-1]?`Sheet total: ${employee.reportedTotals[month-1]}`:'';
  $('#monthTitle').textContent=`${MONTHS[month-1]} ${year} overview`;
  const issueCount=shifts.filter(s=>getIssues(s).length).length;
  $('#reviewCount').textContent=issueCount?String(issueCount):'';
  $('#reviewFilter').setAttribute('aria-pressed',String(reviewOnly));
  $('#reviewBanner').hidden=!(issueCount&&reviewOnly);
  $('#reviewBanner').textContent=issueCount?`${issueCount} record${issueCount===1?'':'s'} need review. Notes and original imported values are preserved; no missing times were guessed.`:'';
  const body=$('#recordsBody');
  body.innerHTML=visible.map(s=>{
    const issues=getIssues(s); const duration=durationSeconds(s);
    const note=s.notes?`<span class="flag">NOTE</span>${escapeHTML(s.notes)}`:issues.length?`<span class="status-tag">${escapeHTML(issues[0])}</span>`:'<span class="status-tag done">Complete</span>';
    return `<tr><td class="date-cell">${escapeHTML(formatDate(s.date))}</td><td class="time-cell">${s.start?escapeHTML(s.start.slice(0,8)):'—'}</td><td class="time-cell">${s.end?escapeHTML(s.end.slice(0,8)):'—'}</td><td class="duration-cell">${duration?escapeHTML(formatDuration(duration)):'—'}</td><td class="row-note">${note}${issues.length>1&&!s.notes?` <span class="status-tag">+${issues.length-1}</span>`:''}</td><td><button class="edit-row" data-edit="${escapeHTML(s.id)}" title="Review or edit record" aria-label="Edit ${escapeHTML(formatDate(s.date))}">✎</button></td></tr>`;
  }).join('');
  $('#emptyState').hidden=visible.length>0;
  $('#tableFooter').textContent=`${visible.length}${reviewOnly?' flagged':''} record${visible.length===1?'':'s'} · Times are calculated from the saved clock-in and clock-out.`;
}
function renderImportWarning() {
  const warnings=appState.warnings||[]; const node=$('#importWarning');
  node.hidden=warnings.length===0;
  node.innerHTML=warnings.map(w=>`<div>⚠ ${escapeHTML(w)}</div>`).join('');
}
function showToast(message) { const node=$('#toast'); node.textContent=message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('show'),2600); }
function clockToggle() {
  const employee=currentEmployee(), now=localDateTime(), open=employee.shifts.find(s=>s.date===now.date&&!s.end);
  if (open) { open.end=now.time; open.source='live'; }
  else employee.shifts.push({id:id(),date:now.date,start:now.time,end:'',notes:'',source:'live',dateMismatch:0});
  save(); render(); showToast(open?'Clock-out saved':'Clock-in saved — have a good shift');
}
function editShift(shiftId) {
  const shift=currentEmployee().shifts.find(s=>s.id===shiftId); if (!shift) return;
  $('#editId').value=shift.id; $('#editDate').value=shift.date; $('#editIn').value=shift.start||''; $('#editOut').value=shift.end||''; $('#editNote').value='';
  $('#editAudit').textContent=shift.source==='import'?`Original import preserved: ${shift.original?.start||'—'} → ${shift.original?.end||'—'}${shift.original?.importedDuration?` · Sheet duration ${shift.original.importedDuration}`:''}`:shift.updatedAt?`Last updated ${new Date(shift.updatedAt).toLocaleString()}`:'New clock record';
  $('#editDialog').showModal();
}
function saveEdit(event) {
  event.preventDefault();
  const employee=currentEmployee(), shift=employee.shifts.find(s=>s.id===$('#editId').value); if (!shift) return;
  const next={date:$('#editDate').value,start:$('#editIn').value,end:$('#editOut').value,notes:$('#editNote').value.trim()};
  const changed=next.date!==shift.date||next.start!==(shift.start||'')||next.end!==(shift.end||'');
  if (changed&&!next.notes) { showToast('Add a note describing the correction.'); $('#editNote').focus(); return; }
  if (next.start&&next.end&&durationSeconds(next)===0) { showToast('Clock-out must be later than clock-in.'); return; }
  appState.audit=appState.audit||[];
  if (changed) appState.audit.push({at:new Date().toISOString(),employee:employee.name,shift:shift.id,before:{date:shift.date,start:shift.start,end:shift.end},after:next,reason:next.notes});
  Object.assign(shift,next,{updatedAt:new Date().toISOString()});
  save(); $('#editDialog').close(); render(); showToast(changed?'Correction saved with audit history':'Record saved');
}
function importEmployee(file) {
  const reader=new FileReader(); reader.onload=()=>{
    try {
      const result=parseCSVImport(String(reader.result),file.name);
      if (appState.employees.some(e=>e.email.toLowerCase()===result.employee.email.toLowerCase())) throw new Error('That employee email is already in this workspace.');
      appState.employees.push(result.employee); appState.activeId=result.employee.id;
      const warnings=[];
      if(result.otherRows.length) warnings.push(`${result.otherRows.length} row${result.otherRows.length===1?'':'s'} for ${result.otherRows.map(r=>r.email).join(', ')} were excluded from ${result.employee.name} to avoid mixing employees’ hours.`);
      if(result.employee.shifts.some(s=>s.dateMismatch)) warnings.push(`${result.employee.shifts.filter(s=>s.dateMismatch).length} imported row(s) have an embedded timestamp date that differs from the row date. Review them; displayed shift dates follow the row date.`);
      appState.warnings=warnings; save(); reviewOnly=false; render(); showToast(`${result.employee.name} imported`);
    } catch(error) { showToast(error.message||'Could not import that CSV.'); }
  }; reader.readAsText(file);
}
function csvEscape(value) { const text=String(value??''); return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text; }
function exportEmployee() {
  const employee=currentEmployee();
  const lines=[['date','clock_in','clock_out','calculated_duration','notes','source'].join(',')];
  for(const s of employee.shifts.slice().sort((a,b)=>a.date.localeCompare(b.date))) lines.push([s.date,s.start,s.end,formatDuration(durationSeconds(s)),s.notes,s.source].map(csvEscape).join(','));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`${employee.name.replace(/[^\p{L}\p{N}-]+/gu,'-').toLowerCase()}-timesheet.csv`;a.click();URL.revokeObjectURL(url);showToast('Timesheet CSV exported');
}
async function init() {
  const stored=localStorage.getItem(STORAGE_KEY);
  if(stored) { try { appState=JSON.parse(stored); } catch { localStorage.removeItem(STORAGE_KEY); } }
  if(!appState) {
    try {
      const response=await fetch('./data/demo-timesheet.csv');
      if(!response.ok) throw new Error('Demo seed CSV not found');
      const result=parseCSVImport(await response.text(),'Demo Employee.csv');
      result.employee.name='Demo Employee';
      appState={employees:[result.employee],activeId:result.employee.id,audit:[],warnings:[]};
      if(result.otherRows.length) appState.warnings.push(`${result.otherRows.length} imported row for ${result.otherRows[0].email} was kept separate from the demo employee’s timesheet. Add that employee separately if needed.`);
      const missing=result.employee.shifts.filter(s=>s.start&&!s.end).length;
      if(missing) appState.warnings.push(`${missing} shift(s) have a missing clock-out. They are marked for review and excluded from calculated hours.`);
      const mismatch=result.employee.shifts.filter(s=>s.dateMismatch).length;
      if(mismatch) appState.warnings.push(`${mismatch} row(s) contain embedded timestamp dates that differ from the shift date; the original values are preserved.`);
      save();
    } catch(error) {
      appState={employees:[{id:id(),name:'Demo Employee',email:'',targets:{},reportedTotals:{},shifts:[]}],activeId:'',audit:[],warnings:[`Could not load the demo data (${error.message}). Use “Import employee CSV” to load a timesheet.`]}; appState.activeId=appState.employees[0].id;
    }
  }
  render();
  $('#clockButton').addEventListener('click',clockToggle);
  $('#monthSelect').addEventListener('change',()=>renderMonth(currentEmployee(),$('#monthSelect').value));
  $('#employeeSelect').addEventListener('change',event=>{appState.activeId=event.target.value;reviewOnly=false;save();render();});
  $('#reviewFilter').addEventListener('click',()=>{reviewOnly=!reviewOnly;renderMonth(currentEmployee(),$('#monthSelect').value);});
  $('#recordsBody').addEventListener('click',event=>{const button=event.target.closest('[data-edit]');if(button)editShift(button.dataset.edit);});
  $('#editForm').addEventListener('submit',saveEdit);
  $('#closeDialog').addEventListener('click',()=>$('#editDialog').close()); $('#cancelEdit').addEventListener('click',()=>$('#editDialog').close());
  $('#importBtn').addEventListener('click',()=>$('#fileInput').click());
  $('#fileInput').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)importEmployee(file);event.target.value='';});
  $('#exportBtn').addEventListener('click',exportEmployee);
}
init();
