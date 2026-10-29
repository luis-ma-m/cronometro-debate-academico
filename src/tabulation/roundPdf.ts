import { jsPDF } from 'jspdf';
import { roundSheet, stampText, type LogStamp } from './exports';
import type { TabRound, TabTournament } from './types';

const REPLACEMENTS: Record<string, string> = {
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-',
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201c': '"', '\u201d': '"', '\u201e': '"',
  '\u2026': '...', '\u20ac': 'EUR', '\u2022': '-', '\u00a0': ' ', '\u2009': ' ', '\u202f': ' ',
};

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
const LINE = 4.2;

/** A4 sheet of the round, drawn as a plain table so it does not depend on any plugin. */
export function roundPdf(tournament: TabTournament, round: TabRound, stamp: LogStamp | null, now: number): Uint8Array {
  const sheet = roundSheet(tournament, round);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: false });
  const left = PAGE.margin;
  const bottom = PAGE.height - PAGE.margin - 8;
  let y = PAGE.margin + 4;

  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    let x = left;
    for (const column of COLUMNS) {
      doc.text(pdfText(column.title), x + 1, y);
      x += column.width;
    }
    y += 2;
    doc.setLineWidth(0.3);
    doc.line(left, y, left + COLUMNS.reduce((total, column) => total + column.width, 0), y);
    y += LINE;
    doc.setFont('helvetica', 'normal');
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(doc.splitTextToSize(pdfText(sheet.tournament), PAGE.width - 2 * left), left, y);
  y += 8;
  doc.setFontSize(12);
  doc.text(pdfText(sheet.title), left, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(pdfText(stampText(stamp, now)), left, y);
  y += 8;
  header();

  for (const row of sheet.rows) {
    const cells = [
      row.venue || '—',
      row.teams[0] + '\n' + row.teams[1] + (row.note ? '\n' + row.note : ''),
      row.side,
      [row.chair ? row.chair + ' (principal)' : '', ...row.wings].filter(Boolean).join('\n'),
    ].map((text, index) => doc.splitTextToSize(pdfText(text), COLUMNS[index].width - 2) as string[]);
    const height = Math.max(...cells.map((lines) => lines.length)) * LINE + 2;
    if (y + height > bottom) {
      doc.addPage();
      y = PAGE.margin + 4;
      header();
    }
    doc.setFontSize(9);
    let x = left;
    cells.forEach((lines, index) => {
      doc.text(lines, x + 1, y);
      x += COLUMNS[index].width;
    });
    y += height - LINE;
    doc.setDrawColor(200);
    doc.line(left, y, left + COLUMNS.reduce((total, column) => total + column.width, 0), y);
    doc.setDrawColor(0);
    y += LINE;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(7);
    doc.text(pdfText('Página ' + page + ' de ' + pages + ' · ' + (stamp ? 'registro n.º ' + stamp.seq + ' · huella ' + stamp.hash : 'registro sin entradas')), left, PAGE.height - PAGE.margin + 2);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
