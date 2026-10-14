codeunit 70410 "CGR Outbox Dispatcher"
{
    var
        NotDeliveredErr: Label 'Outbox entry %1 was not delivered.', Comment = '%1 = entry number';

    procedure DispatchPending(var EntryFilter: Record "CGR Outbox Entry"): Integer
    var
        Pending: Record "CGR Outbox Entry" temporary;
        Delivered: Integer;
    begin
        CollectPending(EntryFilter, Pending);
        Pending.SetCurrentKey("Entry No.");
        if Pending.FindSet() then
            repeat
                if DispatchEntry(Pending."Entry No.") then
                    Delivered += 1;
            until Pending.Next() = 0;
        exit(Delivered);
    end;

    procedure CollectPending(var EntryFilter: Record "CGR Outbox Entry"; var Pending: Record "CGR Outbox Entry" temporary): Integer
    var
        Entry: Record "CGR Outbox Entry";
        Added: Integer;
    begin
        Entry.CopyFilters(EntryFilter);
        Entry.SetRange(Sent, false);
        Entry.SetRange(Failed, false);
        if Entry.FindSet() then
            repeat
                Pending.Init();
                Pending."Entry No." := Entry."Entry No.";
                Pending."Event Type" := Entry."Event Type";
                Pending."Vehicle No." := Entry."Vehicle No.";
                Pending.Payload := Entry.Payload;
                Pending."Created At" := Entry."Created At";
                Pending.Sent := Entry.Sent;
                Pending.Failed := Entry.Failed;
                if Pending.Insert() then
                    Added += 1;
            until Entry.Next() = 0;
        exit(Added);
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
        Delivered := TrySend(Entry);
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

    [TryFunction]
    local procedure TrySend(Entry: Record "CGR Outbox Entry")
    var
        Delivered: Boolean;
    begin
        OnSendEntry(Entry, Delivered);
        if not Delivered then
            Error(NotDeliveredErr, Entry."Entry No.");
    end;

    [IntegrationEvent(false, false)]
    local procedure OnSendEntry(Entry: Record "CGR Outbox Entry"; var Delivered: Boolean)
    begin
    end;
}
