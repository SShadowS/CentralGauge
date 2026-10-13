codeunit 86101 "HX032 Receipt Transport"
{
    EventSubscriberInstance = Manual;

    var
        WritesReceipt: Dictionary of [Code[20], Boolean];
        Delivers: Dictionary of [Code[20], Boolean];
        FailsAfterWrite: Dictionary of [Code[20], Boolean];
        SeenEntryNo: Integer;
        SeenVehicleNo: Code[20];
        TransportDownErr: Label 'HX032 transport down for %1.', Comment = '%1 = vehicle number';

    procedure ConfigureVehicle(VehicleNo: Code[20]; WriteReceipt: Boolean; Deliver: Boolean; FailAfterWrite: Boolean)
    begin
        WritesReceipt.Set(VehicleNo, WriteReceipt);
        Delivers.Set(VehicleNo, Deliver);
        FailsAfterWrite.Set(VehicleNo, FailAfterWrite);
    end;

    procedure MarkerNo(EntryNo: Integer): Code[20]
    begin
        exit(CopyStr('HX032-M' + Format(EntryNo, 0, 9), 1, 20));
    end;

    procedure TransportDownText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(TransportDownErr, VehicleNo));
    end;

    procedure SeenEntry(): Integer
    begin
        exit(SeenEntryNo);
    end;

    procedure SeenVehicle(): Code[20]
    begin
        exit(SeenVehicleNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Dispatcher", 'OnSendEntry', '', false, false)]
    local procedure SendWithReceipt(Entry: Record "CGR Outbox Entry"; var Delivered: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if not Delivers.ContainsKey(Entry."Vehicle No.") then
            exit;
        SeenEntryNo := Entry."Entry No.";
        SeenVehicleNo := Entry."Vehicle No.";
        if WritesReceipt.Get(Entry."Vehicle No.") then begin
            Vehicle.Init();
            Vehicle."No." := MarkerNo(Entry."Entry No.");
            Vehicle.Description := 'HX032 delivery receipt';
            Vehicle.Insert();
        end;
        if FailsAfterWrite.Get(Entry."Vehicle No.") then
            Error(TransportDownErr, Entry."Vehicle No.");
        Delivered := Delivers.Get(Entry."Vehicle No.");
    end;
}
