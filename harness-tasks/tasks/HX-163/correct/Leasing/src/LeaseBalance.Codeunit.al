codeunit 70375 "CGR Lease Balance"
{
    procedure FillBalances(AsOf: Date; var Buffer: Record "CGR Lease Balance Buffer" temporary)
    var
        Lease: Record "CGR Lease Contract";
        LeaseInvoiced: Query "CGR Lease Invoiced";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();
        if Lease.FindSet() then
            repeat
                Buffer.Init();
                Buffer."Lease No." := Lease."No.";
                Buffer."Vehicle No." := Lease."Vehicle No.";
                Buffer.Insert();
            until Lease.Next() = 0;
        LeaseInvoiced.SetFilter(InvoiceDateFilter, '..%1', AsOf);
        LeaseInvoiced.Open();
        while LeaseInvoiced.Read() do
            if Buffer.Get(LeaseInvoiced.LeaseNo) then begin
                Buffer."Invoiced Amount" := LeaseInvoiced.InvoicedAmount;
                Buffer.Invoices := LeaseInvoiced.Invoices;
                Buffer.Modify();
            end;
        LeaseInvoiced.Close();
    end;
}
