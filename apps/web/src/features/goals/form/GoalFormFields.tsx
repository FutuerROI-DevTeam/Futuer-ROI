import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { browserTimezone } from '../../../calendar.ts';
import { goalsCopy } from '../../../copy/goals.ts';
import { longDate } from '../../../copy/date.ts';
import { Button } from '../../../ui/components/Button.tsx';
import { Field, fieldAria, NumberInput, SegmentedControl, SelectInput, TextInput } from '../../../ui/components/FormField.tsx';
import { Icon } from '../../../ui/components/Icon.tsx';
import { QuestionPriorFields } from '../../prior/QuestionPriorFields.tsx';
import { NO_ANSWERS, TITLE_MAX, titleLength, type FieldErrors, type FieldName, type FormValues, type GoalWithAnswers, type answersLockReason } from '../goal-form.ts';

const f = goalsCopy.form;

type Props = {
  values: FormValues;
  errors: FieldErrors;
  count: number;
  unit: string;
  timezones: string[];
  discardedDraft: boolean;
  pendingCreate: boolean;
  refreshNotice: ReactNode;
  inputDisabled: boolean;
  locked: boolean;
  priorOpen: boolean;
  latestAnswers: GoalWithAnswers['questionPrior'] | null;
  answersLock: ReturnType<typeof answersLockReason>;
  update: <K extends FieldName>(name: K, value: FormValues[K]) => void;
  onPriorToggle: (open: boolean) => void;
  onDeleteOpen: () => void;
} & ({ mode: 'create'; goal?: undefined } | { mode: 'edit'; goal: GoalWithAnswers });

/** controlledな項目表示。入力・baseline・保存操作のstateは親フォームだけが持つ。 */
export function GoalFormFields({ mode, goal, values, errors, count, unit, timezones,
  discardedDraft, pendingCreate, refreshNotice, inputDisabled, locked, priorOpen, latestAnswers,
  answersLock, update, onPriorToggle, onDeleteOpen }: Props) {
  return (
    <div className="fr-goalform__fields">
      {discardedDraft ? <p role="status">別の更新があったため最新のGoalを表示しています。未保存の入力は復元していません。</p> : null}
      {pendingCreate ? <p role="status">{f.createRecovery.pending}</p> : null}
      {refreshNotice}
      {count > 0 ? (
        <div className="fr-goalform__summary" role="alert">
          <Icon name="alert" size={20} />
          {f.summary(count)}
        </div>
      ) : null}

      <section className="fr-goalform__group fr-goalform__group--basic" aria-labelledby="fr-goalform-basic-title">
        <header className="fr-goalform__group-head">
          <span className="fr-goalform__group-index" aria-hidden="true">01</span>
          <h2 id="fr-goalform-basic-title">{goalsCopy.formGroups.basic}</h2>
        </header>
        <div className="fr-goalform__group-fields">
          <Field id="goal-title" label={f.title} counter={`${titleLength(values.title)} / ${TITLE_MAX}`} error={errors.title}>
            <TextInput
              id="goal-title"
              value={values.title}
              onChange={(event) => update('title', event.target.value)}
              disabled={inputDisabled}
              invalid={Boolean(errors.title)}
              autoComplete="off"
              {...fieldAria('goal-title', { error: errors.title })}
            />
          </Field>

          <Field id="goal-unit" label={f.unit} group error={errors.unit} help={mode === 'edit' && goal.unitLocked ? (
            <>
              <LockedNote>{goalsCopy.errors.unitLocked}</LockedNote>
              {values.unit !== goal.unit ? <Button variant="secondary" disabled={inputDisabled} onClick={() => update('unit', goal.unit)}>{f.restoreSavedUnit}</Button> : null}
              <Link to="/goals/new" className="fr-goalform__new-goal">{f.createNewGoal}</Link>
            </>
          ) : undefined}>
            <SegmentedControl
              labelledBy="goal-unit-label"
              options={[
                { value: 'minutes', label: f.units.minutes },
                { value: 'sessions', label: f.units.sessions },
              ]}
              value={values.unit}
              onChange={(value) => update('unit', value)}
              disabled={inputDisabled || (mode === 'edit' && goal.unitLocked)}
            />
          </Field>
        </div>
      </section>

      <section className="fr-goalform__group fr-goalform__group--record" aria-labelledby="fr-goalform-record-title">
        <header className="fr-goalform__group-head">
          <span className="fr-goalform__group-index" aria-hidden="true">02</span>
          <h2 id="fr-goalform-record-title">{goalsCopy.formGroups.record}</h2>
        </header>
        <div className="fr-goalform__group-fields">
          {/* デスクトップ幅では2列に並べる（デザイン Desk-create）。スマートフォン幅では1列のまま */}
          <div className="fr-goalform__pair">
            <AmountField id="goal-totalRequired" label={f.totalRequired} unit={unit} value={values.totalRequired} error={errors.totalRequired} disabled={inputDisabled} onChange={(v) => update('totalRequired', v)} />
            <AmountField id="goal-sessionAmount" label={f.sessionAmount} unit={unit} value={values.sessionAmount} error={errors.sessionAmount} disabled={inputDisabled} onChange={(v) => update('sessionAmount', v)} />
          </div>
          <AmountField
            id="goal-initialProgress"
            label={f.initialProgress}
            unit={unit}
            value={values.initialProgress}
            error={errors.initialProgress}
            disabled={inputDisabled || locked}
            onChange={(v) => update('initialProgress', v)}
            help={
              <>
                <p>{goal ? f.initialProgressHelp(longDate(goal.recordStartDate)) : f.initialProgressHelpNew}</p>
                {locked ? <LockedNote>{f.lockedInitialProgress}</LockedNote> : null}
              </>
            }
          />
        </div>
      </section>

      <section className="fr-goalform__group fr-goalform__group--schedule" aria-labelledby="fr-goalform-schedule-title">
        <header className="fr-goalform__group-head">
          <span className="fr-goalform__group-index" aria-hidden="true">03</span>
          <h2 id="fr-goalform-schedule-title">{goalsCopy.formGroups.schedule}</h2>
        </header>
        <div className="fr-goalform__group-fields">
          <div className="fr-goalform__pair">
            {/* 到達予定日（任意、#157、P-19）。記録があっても変えられる */}
            <Field
              id="goal-targetDate"
              label={f.targetDate}
              counter={f.targetDateOptional}
              error={errors.targetDate}
              help={<p>{mode === 'edit' ? f.targetDateEditHelp : f.targetDateHelp}</p>}
            >
              <TextInput
                id="goal-targetDate"
                type="date"
                value={values.targetDate}
                onChange={(event) => update('targetDate', event.target.value)}
                disabled={inputDisabled}
                invalid={Boolean(errors.targetDate)}
                {...fieldAria('goal-targetDate', { help: true, error: errors.targetDate })}
              />
            </Field>
            <Field
              id="goal-timezone"
              label={f.timezone}
              error={errors.timezone}
              help={
                <>
                  <p>{f.timezoneHelp}</p>
                  {locked ? <LockedNote>{f.lockedTimezone}</LockedNote> : null}
                </>
              }
            >
              <SelectInput
                id="goal-timezone"
                value={values.timezone}
                onChange={(event) => update('timezone', event.target.value)}
                disabled={inputDisabled || locked}
                invalid={Boolean(errors.timezone)}
                {...fieldAria('goal-timezone', { help: true, error: errors.timezone })}
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz === browserTimezone() ? f.browserTimezone(tz) : tz}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        </div>
      </section>

      {/* 初期質問は任意なので、開閉できる形で閉じて置く（デザイン C1・R1）。回答・エラー・お知らせがあるときは開いておく */}
      <details
        className="fr-goalform__prior"
        open={priorOpen || Boolean(errors.questionPrior) || latestAnswers !== null || answersLock !== null}
        onToggle={(event) => onPriorToggle(event.currentTarget.open)}
      >
        <summary className="fr-goalform__prior-summary">
          <h2 id="fr-goalform-prior-title" className="fr-goalform__prior-title">
            {f.priorTitleLead}
            <span className="fr-goalform__nowrap">{f.priorTitleTail}</span>
          </h2>
          <Icon name="chevronDown" size={20} />
        </summary>
        {latestAnswers ? (
          <p className="fr-goalform__latest" role="status">
            {f.latestAnswers(answerLabel(latestAnswers.a), answerLabel(latestAnswers.b))}
          </p>
        ) : null}
        <QuestionPriorFields
          externalHeadingId="fr-goalform-prior-title"
          value={answersLock ? NO_ANSWERS : values.questionPrior}
          onChange={(next) => update('questionPrior', next)}
          disabled={inputDisabled || answersLock !== null}
          fieldErrors={errors.questionPrior ? { a: errors.questionPrior } : {}}
        />
        {answersLock ? <LockedNote>{answersLock === 'withdrawn' ? f.answersWithdrawn : f.answersNotSavedWithContext}</LockedNote> : null}
        <p className="fr-goals__help">{f.answersNotRecords}</p>
      </details>

      {mode === 'edit' ? (
        <div className="fr-goalform__delete-mobile">
          <Button variant="text" icon="trash" disabled={inputDisabled} onClick={onDeleteOpen}>
            {f.delete}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function AmountField({
  id,
  label,
  unit,
  value,
  error,
  disabled,
  onChange,
  help,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
  help?: ReactNode;
}) {
  return (
    <Field id={id} label={label} error={error} help={help}>
      <NumberInput id={id} suffix={unit} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} invalid={Boolean(error)} {...fieldAria(id, { help, error })} />
    </Field>
  );
}

function LockedNote({ children }: { children: string }) {
  return (
    <p className="fr-goalform__locked">
      <Icon name="info" size={16} />
      {children}
    </p>
  );
}

const answerLabel = (answer: NonNullable<GoalWithAnswers['questionPrior']>['a']) => f.answerLabels[answer ?? 'none'];
