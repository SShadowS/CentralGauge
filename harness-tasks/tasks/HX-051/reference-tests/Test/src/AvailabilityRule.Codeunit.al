codeunit 80104 "CGR Availability Rule"
{
    EventSubscriberInstance = Manual;

    var
        RuleVehicleNo: Code[20];
        RuleResult: Boolean;
        Hits: Integer;

    procedure SetRule(VehicleNo: Code[20]; NewResult: Boolean)
    begin
        RuleVehicleNo := VehicleNo;
        RuleResult := NewResult;
    end;

    procedure HitCount(): Integer
    begin
        exit(Hits);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fleet Mgt", 'OnBeforeIsAvailable', '', false, false)]
    local procedure DecideAvailability(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)
    begin
        if (RuleVehicleNo = '') or (VehicleNo <> RuleVehicleNo) then
            exit;
        Hits += 1;
        Result := RuleResult;
        IsHandled := true;
    end;
}
