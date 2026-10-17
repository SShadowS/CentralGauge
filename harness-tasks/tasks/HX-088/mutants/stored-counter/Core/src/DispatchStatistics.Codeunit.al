codeunit 70017 "CGR Dispatch Statistics"
{
    SingleInstance = true;

    procedure RecordDispatch(Delivered: Boolean; EntryFailed: Boolean)
    var
        Counter: Record "CGR Dispatch Counter";
    begin
        if not Counter.Get('') then begin
            Counter.Init();
            Counter."Primary Key" := '';
            Counter.Insert();
        end;
        Counter."Attempt Count" += 1;
        if Delivered then
            Counter."Delivered Count" += 1;
        if EntryFailed then
            Counter."Failure Count" += 1;
        Counter.Modify();
    end;

    procedure DispatchAttempts(): Integer
    var
        Counter: Record "CGR Dispatch Counter";
    begin
        if Counter.Get('') then
            exit(Counter."Attempt Count");
        exit(0);
    end;

    procedure DispatchDelivered(): Integer
    var
        Counter: Record "CGR Dispatch Counter";
    begin
        if Counter.Get('') then
            exit(Counter."Delivered Count");
        exit(0);
    end;

    procedure DispatchFailures(): Integer
    var
        Counter: Record "CGR Dispatch Counter";
    begin
        if Counter.Get('') then
            exit(Counter."Failure Count");
        exit(0);
    end;

    procedure ResetDispatchStatistics()
    var
        Counter: Record "CGR Dispatch Counter";
    begin
        Counter.DeleteAll();
    end;
}
