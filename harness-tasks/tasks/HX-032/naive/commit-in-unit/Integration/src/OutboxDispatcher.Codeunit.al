codeunit 70410 "CGR Outbox Dispatcher"
{
    TableNo = "CGR Outbox Entry";

    var
        NotDeliveredErr: Label 'Outbox entry %1 was not delivered.', Comment = '%1 = entry number';

    trigger OnRun()
    var
        Delivered: Boolean;
    begin
        OnSendEntry(Rec, Delivered);
        Commit();
        if not Delivered then
            Error(NotDeliveredErr, Rec."Entry No.");
    end;

    procedure DispatchPending(var EntryFilter: Record "CGR Outbox Entry"): Integer
    var
        Entry: Record "CGR Outbox Entry";
        EntryNos: List of [Integer];
        EntryNo: Integer;
        Delivered: Integer;
    begin
        Entry.CopyFilters(EntryFilter);
        Entry.SetRange(Sent, false);
        Entry.SetRange(Failed, false);
        if Entry.FindSet() then
            repeat
                EntryNos.Add(Entry."Entry No.");
            until Entry.Next() = 0;
        foreach EntryNo in EntryNos do
            if DispatchEntry(EntryNo) then
                Delivered += 1;
        exit(Delivered);
    end;

    procedure DispatchEntry(EntryNo: Integer): Boolean
    var
        Entry: Record "CGR Outbox Entry";
        Delivered: Boolean;
    begin
        Entry.Get(EntryNo);
        Entry.Attempts += 1;
        Entry."Last Attempt At" := CurrentDateTime();
        Entry.Modify(true);
        Commit();
        ClearLastError();
        Delivered := Codeunit.Run(Codeunit::"CGR Outbox Dispatcher", Entry);
        Entry.Get(EntryNo);
        if Delivered then begin
            Entry.Sent := true;
            Entry."Last Error" := '';
        end else begin
            Entry."Last Error" := CopyStr(GetLastErrorText(), 1, MaxStrLen(Entry."Last Error"));
            Entry.Failed := Entry.Attempts >= MaxAttempts();
        end;
        Entry.Modify(true);
        exit(Delivered);
    end;

    procedure Requeue(EntryNo: Integer)
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Get(EntryNo);
        Entry.Failed := false;
        Entry.Attempts := 0;
        Entry."Last Error" := '';
        Entry.Modify(true);
    end;

    procedure MaxAttempts(): Integer
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        SessionContext.GetSetup(Setup);
        if Setup."Outbox Max Attempts" <= 0 then
            exit(3);
        exit(Setup."Outbox Max Attempts");
    end;

    [IntegrationEvent(false, false)]
    local procedure OnSendEntry(Entry: Record "CGR Outbox Entry"; var Delivered: Boolean)
    begin
    end;
}
