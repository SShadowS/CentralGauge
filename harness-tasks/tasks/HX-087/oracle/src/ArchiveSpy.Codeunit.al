codeunit 87201 "HX087 Archive Spy"
{
    EventSubscriberInstance = Manual;

    var
        SeenNos: List of [Integer];
        SeenStored: List of [Boolean];
        RefusedNo: Integer;
        RefusedErr: Label 'HX087 archive refused %1.', Comment = '%1 = entry number';

    procedure HX087Refuse(EntryNo: Integer)
    begin
        RefusedNo := EntryNo;
    end;

    procedure HX087SeenCount(): Integer
    begin
        exit(SeenNos.Count());
    end;

    procedure HX087Saw(EntryNo: Integer): Boolean
    begin
        exit(SeenNos.Contains(EntryNo));
    end;

    procedure HX087AllStored(): Boolean
    begin
        exit(not SeenStored.Contains(false));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Integration Facade", 'OnBeforePurgeEntry', '', false, false)]
    local procedure HX087ArchiveEntry(Entry: Record "CGR Outbox Entry")
    var
        Stored: Record "CGR Outbox Entry";
        Marker: Record "CGR Outbox Entry";
    begin
        SeenNos.Add(Entry."Entry No.");
        SeenStored.Add(Stored.Get(Entry."Entry No."));
        Marker.Init();
        Marker."Event Type" := 'hx087Archive';
        Marker."Vehicle No." := 'HX087-ARC';
        Marker.Payload := Format(Entry."Entry No.", 0, 9);
        Marker.Insert();
        if Entry."Entry No." = RefusedNo then
            Error(RefusedErr, Format(Entry."Entry No.", 0, 9));
    end;
}
