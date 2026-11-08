codeunit 80542 "CGR Redelivery Runner"
{
    var
        CheckEntryNo: Integer;
        RunAt: DateTime;
        RunRetry: Boolean;
        DueInRun: Boolean;
        SentInRun: Integer;

    trigger OnRun()
    var
        Redelivery: Codeunit "CGR Outbox Redelivery";
    begin
        if RunRetry then
            SentInRun := Redelivery.RetryDue(RunAt)
        else
            DueInRun := Redelivery.IsDue(CheckEntryNo, RunAt);
    end;

    procedure SetDueCheck(EntryNo: Integer; At: DateTime)
    begin
        RunRetry := false;
        CheckEntryNo := EntryNo;
        RunAt := At;
    end;

    procedure SetRetryRun(At: DateTime)
    begin
        RunRetry := true;
        RunAt := At;
    end;

    procedure DueInRedeliveryRun(): Boolean
    begin
        exit(DueInRun);
    end;

    procedure SentInRedeliveryRun(): Integer
    begin
        exit(SentInRun);
    end;
}
