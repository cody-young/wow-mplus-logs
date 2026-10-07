import { pullSummary } from '../format.js';
import { shortName, specOf } from '../specs.js';
import type { PullReport, RunAnalysis } from '../../shared.js';
import { partyOf } from './RunRow.js';
import { SpecIcon } from './SpecIcon.js';

/**
 * Who pulled a raid boss, as a header stat: the name in its class colour, what
 * they did beneath it, and every contact around the pull on hover.
 */
export function PullStat({ analysis, pull }: { analysis: RunAnalysis; pull: PullReport }) {
  const summary = pullSummary(pull, analysis.names);
  const member = partyOf(analysis).find((candidate) => candidate.actorIndex === summary.actor);
  const title = [summary.caveat, ...summary.lines].filter((line) => line !== null).join('\n');
  return (
    <div className="stat pull-stat" title={title}>
      <span className="label">{summary.label}</span>
      <span className="value">
        {member === undefined ? null : (
          <>
            <SpecIcon specId={member.specId} />{' '}
            <span style={{ color: specOf(member.specId).color }}>{shortName(member.name)}</span>
          </>
        )}
        {summary.detail === '' ? null : (
          <span className="pull-detail">
            {member === undefined ? '' : ' · '}
            {summary.detail}
          </span>
        )}
      </span>
      {summary.caveat === null ? null : <span className="pull-caveat">{summary.caveat}</span>}
    </div>
  );
}
