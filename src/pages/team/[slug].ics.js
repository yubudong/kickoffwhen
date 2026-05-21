/**
 * /team/[slug].ics — ICS calendar feed for a team's matches
 *
 * Static-generates 48 .ics files at build time (one per team).
 * Each event runs from kickoff UTC to +2h.
 * Compatible with Google Calendar, Apple Calendar, Outlook.
 */

import matchesData from '../../data/matches.json';
import teamsData from '../../data/teams.json';

export function getStaticPaths() {
  return Object.keys(teamsData).map(slug => ({
    params: { slug },
    props: { slug, team: teamsData[slug] },
  }));
}

// Convert ISO "2026-06-14T20:00:00Z" → "20260614T200000Z" (ICS format)
function icsDate(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Add 2 hours to ISO timestamp
function plusTwoHours(iso) {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() + 2);
  return d.toISOString().replace(/\.\d{3}/, '');
}

// Escape ICS reserved chars
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function fold(line) {
  // ICS spec says lines should be <=75 octets; long lines folded with CRLF + space.
  if (line.length <= 73) return line;
  const out = [];
  let i = 0;
  out.push(line.slice(0, 73));
  i = 73;
  while (i < line.length) {
    out.push(' ' + line.slice(i, i + 72));
    i += 72;
  }
  return out.join('\r\n');
}

export async function GET({ props }) {
  const { slug, team } = props;
  const teamEnName = team.name_en;

  const myMatches = matchesData.filter(m =>
    m.home_team === teamEnName || m.away_team === teamEnName
  );

  const stamp = '20260521T000000Z';  // DTSTAMP — fixed at build time

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KickoffWhen//World Cup 2026//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(teamEnName)} — 2026 World Cup`,
    `X-WR-CALDESC:${esc(`${teamEnName}'s matches at the 2026 FIFA World Cup. From kickoffwhen.com`)}`,
  ];

  for (const m of myMatches) {
    const summary = `${team.flag} ${m.home_team} vs ${m.away_team} ${(teamsData[Object.keys(teamsData).find(s => teamsData[s].name_en === (m.home_team === teamEnName ? m.away_team : m.home_team))] || {}).flag || ''}`.trim();
    const stage = m.stage === 'group' ? `Group ${m.group} · MD${m.matchday}` : m.stage;
    const description = `${m.match_label} — ${stage}\nLocal kickoff: ${m.kickoff_local || 'TBD'} (${m.venue_timezone || 'TBD'})\nDetails: https://kickoffwhen.com/match/${m.id}`;
    const location = `${m.venue_name}, ${m.venue_city}`;

    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:${m.id}@kickoffwhen.com`));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${icsDate(m.kickoff_utc)}`);
    lines.push(`DTEND:${icsDate(plusTwoHours(m.kickoff_utc))}`);
    lines.push(fold(`SUMMARY:${esc(summary)}`));
    lines.push(fold(`DESCRIPTION:${esc(description)}`));
    lines.push(fold(`LOCATION:${esc(location)}`));
    lines.push(fold(`URL:https://kickoffwhen.com/match/${m.id}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  const body = lines.join('\r\n') + '\r\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="kickoffwhen-${slug}.ics"`,
    },
  });
}
