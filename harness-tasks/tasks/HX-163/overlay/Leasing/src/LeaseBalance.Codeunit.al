codeunit 70375 "CGR Lease Balance"
{
    procedure FillBalances(AsOf: Date; var Buffer: Record "CGR Lease Balance Buffer" temporary)
    var
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
    end;
}
