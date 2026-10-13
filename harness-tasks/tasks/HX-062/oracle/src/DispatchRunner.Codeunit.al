codeunit 86702 "HX062 Dispatch Runner"
{
    var
        RunEntryNo: Integer;
        RunMode: Option Dispatch,RecordAttempt,RecordAttemptThenFail;
        LaterStepErr: Label 'HX062 later step failed.';

    trigger OnRun()
    var
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
    begin
        case RunMode of
            RunMode::Dispatch:
                Dispatcher.DispatchEntry(RunEntryNo);
            RunMode::RecordAttempt:
                Dispatcher.RecordAttempt(RunEntryNo);
            RunMode::RecordAttemptThenFail:
                begin
                    Dispatcher.RecordAttempt(RunEntryNo);
                    Error(LaterStepErr);
                end;
        end;
    end;

    procedure SetDispatch(EntryNo: Integer)
    begin
        RunEntryNo := EntryNo;
        RunMode := RunMode::Dispatch;
    end;

    procedure SetRecordAttempt(EntryNo: Integer)
    begin
        RunEntryNo := EntryNo;
        RunMode := RunMode::RecordAttempt;
    end;

    procedure SetRecordAttemptThenFail(EntryNo: Integer)
    begin
        RunEntryNo := EntryNo;
        RunMode := RunMode::RecordAttemptThenFail;
    end;
}
