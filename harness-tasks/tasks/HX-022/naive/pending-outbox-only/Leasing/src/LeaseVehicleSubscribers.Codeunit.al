codeunit 70315 "CGR Lease Vehicle Subscribers"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleNoChanged', '', false, false)]
    local procedure MoveLeaseRecords(OldVehicleNo: Code[20]; NewVehicleNo: Code[20])
    var
        LeaseContract: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        LeaseContract.SetRange("Vehicle No.", OldVehicleNo);
        LeaseContract.ModifyAll("Vehicle No.", NewVehicleNo);
        InvoiceLine.SetRange("Vehicle No.", OldVehicleNo);
        InvoiceLine.ModifyAll("Vehicle No.", NewVehicleNo);
    end;
}
