codeunit 70435 "CGR Invoice Dispatcher"
{
    procedure QueueInvoice(ContractNo: Code[20]): Integer
    var
        Entry: Record "CGR Invoice Dispatch Entry";
    begin
        Entry.Init();
        Entry."Contract No." := ContractNo;
        Entry."Queued At" := CurrentDateTime();
        Entry.Insert();
        exit(Entry."Entry No.");
    end;

    procedure ProcessQueue()
    var
        Entry: Record "CGR Invoice Dispatch Entry";
        EntryNos: List of [Integer];
        EntryNo: Integer;
    begin
        Entry.SetCurrentKey("Entry No.");
        if Entry.FindSet() then
            repeat
                EntryNos.Add(Entry."Entry No.");
            until Entry.Next() = 0;
        foreach EntryNo in EntryNos do
            if Entry.Get(EntryNo) then begin
                Commit();
                if not Codeunit.Run(Codeunit::"CGR Invoice Dispatch Run", Entry) then begin
                    Entry.Error := true;
                    Entry."Error Message" := CopyStr(GetLastErrorText(), 1, MaxStrLen(Entry."Error Message"));
                    Entry."Retry Count" += 1;
                    Entry.Modify();
                end;
            end;
    end;
}
