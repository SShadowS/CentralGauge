codeunit 85901 "HX022 Renumber Runner"
{
    var
        FromVehicleNo: Code[20];
        ToVehicleNo: Code[20];

    trigger OnRun()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        FleetMgt.ChangeVehicleNo(FromVehicleNo, ToVehicleNo);
    end;

    procedure SetRenumberPair(OldNo: Code[20]; NewNo: Code[20])
    begin
        FromVehicleNo := OldNo;
        ToVehicleNo := NewNo;
    end;
}
