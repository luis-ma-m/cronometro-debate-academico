import { jsPDF } from 'jspdf';
import { roundSheet, stampText, type LogStamp } from './exports';
import type { TabRound, TabTournament } from './types';

const REPLACEMENTS: Record<string, string> = {
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201c': '"', '\u201d': '"', '\u201e': '"',
  '\u2026': '...', '\u20ac': 'EUR', '\u2022': '-', '\u00a0': ' ', '\u2009': ' ', '\u202f': ' ',
};

/** JPEG supplied for the public round sheet; embedded so exports never depend on a remote URL. */
const LOGO = 'data:image/jpeg;base64,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5U6STsTGW2Y7c6TIdKMq1/tBJ6bvTrCff1hP2pfgSr3Ifc/jhEqu2lloaHznXhdXop5T4rJYR8BiKMZ3z7h7p09FBLYK0NToW9gqUS/TP0S68PxOr0Ut5QUrDw8bv2VFOWxnYN1fuUXA0lwakyHZzcZ2LRpfSsW24+BBRGwYNAQcPw2r0u8myopjQcxpUws8zD5ZbAII4gj2aNsGwXVoGiTuLmlflm8uJ5bX6eI0+hlATESR6UvIHcfYChok8ULvNXd+L5DX6KfLt+hiJhltJCl+huHXLkw058i36IygJZEkelAGAAFgDAPuX//aAAwDAQECAQMBAAAQ888888888o888887388o8888ziq88o888pgfk88o88xYY8o88o88fsgk888o88888Qc88o888Y88888o888888888owwwwwwwwwg/9oACAEDAQE/EOOy2EIghpCH9AXscCO8XibY0rqbmesavarCGvyH/tReZnKWBzY7BWdS7CynagABAYBYP+163FwXN1/cbUHuGOeCAw+4f//aAAgBAgEBPxDjkCI4JioSS9UDu8D/AAEFC9CMuej34CAWQiJzhi8mG61l0O4NqVVVlcVz/wCz6HA4pkafqF+Eg1Z+4f/aAAgBAQEBPxD7h/mpwgaACTBBHklvoDTHUIAlVbAF1pbVr6/9gHYG9orMPNwZ50yL+pV8520NTbxYTajisSb61KvLF/O7tE8aM6WLFEfD5LOjDboDj+ioCTA0ClTPAFDkBda1ub5Phma6usK1EmxaLI4z38jQwEc1F44ePyq4cGkDwgStKxEZbdQf7ObWNt7RfblYpAUnFcPAtT3ycqdklJXdvW1aMiYOdivozrCquHu5q5rd9BAI7xJ8XnAR0nKfidGbaaDsUfMwrIhqxQm4GdA9TNY0yHhgpwqM7vxZ2uDbFx7I8C0sag0cvHkVAHc+amRgh7nryc3f+K5Uh3/Vwi7McZ0AaMcAVuSJBm3oT3L13J/5B5GVZhPU/wAh6GSzI835j1hHMKSl0McKZbkeokt7qGK8mnC6egSHX4VJEUc1OCwzOZ5az9IsgBVbAGK8itTRpYWGt84e9A4r9uEverLNEeV73VRq8TDNrrDkGpqUXfykB3PjEzolt+f41YMQncyUBpt06r2K2GFYgdjig1I1rhxYeIEPLZLjcvWX5ytfDRO2PRT3EgkAU1Zuga55d71E2zeBqr30DILxXK9BR4jAwHJUic68S5r2jTzYw7mOouK4X02Za/Q+5ISokRKmcTV898f3m2aJdr9FY8RgwHEVImzRsTKg0ALAFg+5f//Z';
const BLUE: [number, number, number] = [20, 116, 189];
const PALE_BLUE: [number, number, number] = [235, 245, 252];
const INK: [number, number, number] = [31, 45, 58];
const MUTED: [number, number, number] = [103, 116, 128];

/**
 * Text the PDF standard fonts can print: Latin-1 keeps every Spanish letter (á, ñ, ü, º, «»), typographic
 * punctuation becomes its ASCII form and anything else becomes «?».
 */
export function pdfText(text: string): string {
  let result = '';
  for (const char of text.normalize('NFC')) {
    const replacement = REPLACEMENTS[char];
    if (replacement !== undefined) result += replacement;
    else if (char === '\n') result += char;
    else if (char < ' ') result += ' ';
    else result += char.codePointAt(0)! <= 0xff ? char : '?';
  }
  return result;
}

const PAGE = { width: 210, height: 297, margin: 14 };
const COLUMNS = [
  { title: 'Sala', width: 30 },
  { title: 'Equipos', width: 64 },
  { title: 'Postura', width: 30 },
  { title: 'Jurado', width: 58 },
];
const TABLE_WIDTH = COLUMNS.reduce((total, column) => total + column.width, 0);
const LINE = 4.5;
const FOOTER_Y = PAGE.height - PAGE.margin - 1;

function drawBrandHeader(doc: jsPDF, tournamentName: string, roundTitle: string, stampTextValue: string, compact = false) {
  const left = PAGE.margin;
  if (!compact) {
    doc.setFillColor(...BLUE);
    doc.rect(0, 0, PAGE.width, 5, 'F');
    doc.setFillColor(248, 250, 252);
    doc.rect(0, 5, PAGE.width, 40, 'F');
    doc.addImage(LOGO, 'JPEG', left, 9, 27, 27, undefined, 'FAST');
    doc.setTextColor(...BLUE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    const tournamentLines = doc.splitTextToSize(pdfText(tournamentName), PAGE.width - left * 2 - 34);
    doc.text(tournamentLines, left + 33, 17);
    doc.setTextColor(...INK);
    doc.setFontSize(12);
    doc.text(pdfText(roundTitle), left + 33, 17 + Math.min(tournamentLines.length, 2) * 6 + 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(stampTextValue), left + 33, 17 + Math.min(tournamentLines.length, 2) * 6 + 8);
    doc.setFillColor(...BLUE);
    doc.roundedRect(left, 49, 34, 1.5, 0.7, 0.7, 'F');
    doc.setTextColor(...INK);
    return 61;
  }
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, PAGE.width, 3, 'F');
  doc.addImage(LOGO, 'JPEG', left, 7, 13, 13, undefined, 'FAST');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BLUE);
  doc.text(pdfText(tournamentName), left + 17, 13);
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(pdfText(roundTitle), left + 17, 18);
  doc.setTextColor(...INK);
  return 27;
}

function drawTableHeader(doc: jsPDF, y: number): number {
  doc.setFillColor(...BLUE);
  doc.roundedRect(PAGE.margin, y - 4, TABLE_WIDTH, 8, 1.2, 1.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  let x = PAGE.margin;
  for (const column of COLUMNS) {
    doc.text(pdfText(column.title.toUpperCase()), x + 2, y + 1);
    x += column.width;
  }
  doc.setTextColor(...INK);
  return y + 7;
}

/** Branded A4 public draw. All assets are embedded; no network access is needed to render the PDF. */
export function roundPdf(tournament: TabTournament, round: TabRound, stamp: LogStamp | null, now: number): Uint8Array {
  const sheet = roundSheet(tournament, round);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  let y = drawBrandHeader(doc, sheet.tournament, sheet.title, stampText(stamp, now));
  const bottom = FOOTER_Y - 4;
  y = drawTableHeader(doc, y);

  for (const [index, row] of sheet.rows.entries()) {
    const cells = [
      row.venue || '—',
      row.teams[0] + '\n' + row.teams[1] + (row.note ? '\n' + row.note : ''),
      row.side || '—',
      [row.chair ? row.chair + ' (principal)' : '', ...row.wings].filter(Boolean).join('\n') || '—',
    ].map((value, cellIndex) => doc.splitTextToSize(pdfText(value), COLUMNS[cellIndex].width - 4) as string[]);
    const height = Math.max(...cells.map((lines) => lines.length)) * LINE + 5;
    if (y + height > bottom) {
      doc.addPage();
      y = drawBrandHeader(doc, sheet.tournament, sheet.title, '', true);
      y = drawTableHeader(doc, y);
    }

    if (index % 2 === 0) {
      doc.setFillColor(...PALE_BLUE);
      doc.roundedRect(PAGE.margin, y - 3.5, TABLE_WIDTH, height, 1, 1, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    let x = PAGE.margin;
    cells.forEach((lines, cellIndex) => {
      if (cellIndex === 0) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...BLUE);
      } else if (cellIndex === 1) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...INK);
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...INK);
      }
      doc.text(lines, x + 2, y);
      x += COLUMNS[cellIndex].width;
    });
    y += height;
    doc.setDrawColor(220, 228, 235);
    doc.setLineWidth(0.2);
    doc.line(PAGE.margin, y - 1, PAGE.margin + TABLE_WIDTH, y - 1);
    y += 1.5;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(...BLUE);
    doc.setLineWidth(0.45);
    doc.line(PAGE.margin, FOOTER_Y - 2, PAGE.margin + TABLE_WIDTH, FOOTER_Y - 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    const footer = 'Página ' + page + ' de ' + pages + (page === 1 ? ' · ' + (stamp ? 'registro n.º ' + stamp.seq + ' · huella ' + stamp.hash : 'registro sin entradas') : '');
    doc.text(pdfText(footer), PAGE.margin, FOOTER_Y + 2);
    doc.setTextColor(...INK);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
