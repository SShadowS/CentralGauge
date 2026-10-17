codeunit 80142 "CGR Dispatch Stats Runner"
{
    var
        EntryNo: Integer;
        LaterStepErr: Label 'Later step failed.';

    trigger OnRun()
    var
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
    begin
        Dispatcher.DispatchEntry(EntryNo);
        Error(LaterStepErr);
    end;

    procedure SetEntryNo(NewEntryNo: Integer)
    begin
        EntryNo := NewEntryNo;
    end;
}
