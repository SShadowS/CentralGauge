codeunit 70017 "CGR Dispatch Statistics"
{
    var
        AttemptCount: Integer;
        DeliveredCount: Integer;
        FailureCount: Integer;

    procedure RecordDispatch(Delivered: Boolean; EntryFailed: Boolean)
    begin
        AttemptCount += 1;
        if Delivered then
            DeliveredCount += 1;
        if EntryFailed then
            FailureCount += 1;
    end;

    procedure DispatchAttempts(): Integer
    begin
        exit(AttemptCount);
    end;

    procedure DispatchDelivered(): Integer
    begin
        exit(DeliveredCount);
    end;

    procedure DispatchFailures(): Integer
    begin
        exit(FailureCount);
    end;

    procedure ResetDispatchStatistics()
    begin
        AttemptCount := 0;
        DeliveredCount := 0;
        FailureCount := 0;
    end;
}
