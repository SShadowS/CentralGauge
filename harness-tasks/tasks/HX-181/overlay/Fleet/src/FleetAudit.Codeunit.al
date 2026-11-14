codeunit 70128 "CGR Fleet Audit"
{
    procedure AuditVehicle(VehicleNo: Code[20]; AuditDate: Date; var Finding: Record "CGR Fleet Audit Finding" temporary)
    begin
        Finding.Reset();
        Finding.DeleteAll();
        Finding.Init();
        Finding."Vehicle No." := VehicleNo;
        Finding."Audit Date" := AuditDate;
        Codeunit.Run(Codeunit::"CGR Vehicle Audit Check", Finding);
    end;
}
