codeunit 70375 "CGR Lease Balance"
{
    procedure FillBalances(AsOf: Date; var Buffer: Record "CGR Lease Balance Buffer" temporary)
    var
        Lease: Record "CGR Lease Contract";
        LeaseInvoice: Record "CGR Lease Invoice";
        LeaseInvoiced: Query "CGR Lease Invoiced";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();
        LeaseInvoiced.SetFilter(InvoiceDateFilter, '..%1', AsOf);
        LeaseInvoiced.Open();
        while LeaseInvoiced.Read() do begin
            Buffer.Init();
            Buffer."Vehicle No." := LeaseInvoiced.VehicleNo;
            Buffer."Lease No." := LeaseInvoiced.LeaseNo;
            Buffer."Invoiced Amount" := LeaseInvoiced.InvoicedAmount;
            Buffer.Invoices := LeaseInvoiced.Invoices;
            Buffer.Insert();
        end;
        LeaseInvoiced.Close();

        if Lease.FindSet() then
            repeat
                LeaseInvoice.SetRange("Contract No.", Lease."No.");
                if LeaseInvoice.IsEmpty() then begin
                    Buffer.Init();
                    Buffer."Vehicle No." := Lease."Vehicle No.";
                    Buffer."Lease No." := Lease."No.";
                    Buffer.Insert();
                end;
            until Lease.Next() = 0;
    end;
}
