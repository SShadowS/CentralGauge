codeunit 80073 "CGR Service Registered Spy"
{
    EventSubscriberInstance = Manual;

    var
        Hits: Integer;
        SeenVehicleNo: Code[20];
        SeenKm: Integer;
        SeenDate: Date;

    procedure HitCount(): Integer
    begin
        exit(Hits);
    end;

    procedure SeenServiceVehicleNo(): Code[20]
    begin
        exit(SeenVehicleNo);
    end;

    procedure SeenServiceKm(): Integer
    begin
        exit(SeenKm);
    end;

    procedure SeenServiceDate(): Date
    begin
        exit(SeenDate);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Service Plan Mgt", 'OnAfterServiceRegistered', '', false, false)]
    local procedure RecordServiceRegistered(var Vehicle: Record "CGR Vehicle")
    begin
        Hits += 1;
        SeenVehicleNo := Vehicle."No.";
        SeenKm := Vehicle."Last Service Km";
        SeenDate := Vehicle."Last Service Date";
    end;
}
