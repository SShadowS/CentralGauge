codeunit 80562 "CGR Claim Insurer Spy"
{
    EventSubscriberInstance = Manual;

    var
        SentEntries: List of [Integer];
        RefusedEntryNo: Integer;
        RefusedErr: Label 'HX149 insurer refused the damage.', Locked = true;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Claim Export", 'OnExportDamage', '', false, false)]
    local procedure RecordSentDamage(DamageEntry: Record "CGR Damage Entry")
    begin
        SentEntries.Add(DamageEntry."Entry No.");
        if (RefusedEntryNo <> 0) and (DamageEntry."Entry No." = RefusedEntryNo) then
            Error(RefusedErr);
    end;

    procedure Refuse(EntryNo: Integer)
    begin
        RefusedEntryNo := EntryNo;
    end;

    procedure SentCount(): Integer
    begin
        exit(SentEntries.Count());
    end;

    procedure WasSent(EntryNo: Integer): Boolean
    begin
        exit(SentEntries.Contains(EntryNo));
    end;

    procedure RefusalText(): Text
    begin
        exit(RefusedErr);
    end;
}
