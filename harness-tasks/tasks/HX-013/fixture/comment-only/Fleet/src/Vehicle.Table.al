table 70100 "CGR Vehicle"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Mileage; Integer) { }
        field(3; "Checked Out"; Boolean) { }
        field(4; Strategy; Enum "CGR Maintenance Strategy") { }
        field(5; Blocked; Boolean) { }
        field(6; "Last Service Km"; Integer) { }
        field(7; "Daily Rate"; Decimal) { }
        field(8; Description; Text[100]) { }
        field(9; "Open Damages"; Integer) { }
        field(10; "Service Plan Code"; Code[20]) { TableRelation = "CGR Service Plan"; }
        field(11; "Last Service Date"; Date) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }

    procedure UpdateBlockedState(AtDate: Date)
    begin
        // Due for service: same rule as ServicePlanMgt.IsServiceDue(Rec."No.", AtDate).
        Blocked := ("Open Damages" > 0) or DueForServiceAt(AtDate);
    end;

    local procedure DueForServiceAt(AtDate: Date): Boolean
    var
        ServicePlan: Record "CGR Service Plan";
        StrategyImpl: Interface "CGR Maintenance Strategy";
    begin
        StrategyImpl := Rec.Strategy;
        if Mileage >= StrategyImpl.NextServiceKm("Last Service Km") then
            exit(true);
        if ("Service Plan Code" = '') or ("Last Service Date" = 0D) then
            exit(false);
        if not ServicePlan.Get("Service Plan Code") then
            exit(false);
        if ServicePlan."Interval Months" = 0 then
            exit(false);
        exit(AtDate >= CalcDate(StrSubstNo('<+%1M>', ServicePlan."Interval Months"), "Last Service Date"));
    end;
}
