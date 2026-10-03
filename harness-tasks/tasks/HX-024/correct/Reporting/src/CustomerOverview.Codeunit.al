codeunit 70512 "CGR Customer Overview"
{
    procedure OpenLeaseAmount(CustomerName: Text[100]): Decimal
    var
        LeaseContract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Total: Decimal;
    begin
        LeaseContract.SetRange("Customer Name", CustomerName);
        if LeaseContract.FindSet() then
            repeat
                ScheduleLine.SetRange("Contract No.", LeaseContract."No.");
                ScheduleLine.SetRange(Invoiced, false);
                if ScheduleLine.FindSet() then
                    repeat
                        Total += ScheduleLine.Amount;
                    until ScheduleLine.Next() = 0;
            until LeaseContract.Next() = 0;
        exit(Total);
    end;

    procedure ActiveRentalCount(CustomerName: Text[100]): Integer
    var
        RentalContract: Record "CGR Rental Contract";
    begin
        RentalContract.SetRange("Customer Name", CustomerName);
        RentalContract.SetFilter(Status, '%1|%2', RentalContract.Status::Open, RentalContract.Status::"Checked Out");
        exit(RentalContract.Count());
    end;
}
