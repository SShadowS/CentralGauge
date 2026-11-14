codeunit 70397 "CGR Lease Billing Preview"
{
    procedure PreviewBilling(ContractNo: Code[20]; UpToDate: Date; var Preview: Record "CGR Lease Invoice Line" temporary)
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        AmountRounding: Codeunit "CGR Amount Rounding";
    begin
        Preview.Reset();
        Preview.DeleteAll();
        Contract.Get(ContractNo);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetRange("Due Date", 0D, UpToDate);
        if ScheduleLine.FindSet() then
            repeat
                Preview.Init();
                Preview."Contract No." := Contract."No.";
                Preview."Schedule Line No." := ScheduleLine."Line No.";
                Preview."Vehicle No." := Contract."Vehicle No.";
                Preview."Customer Name" := Contract."Customer Name";
                Preview."Due Date" := ScheduleLine."Due Date";
                Preview."Invoice Date" := LeaseInvoicing.InvoiceDate(ScheduleLine."Due Date");
                Preview.Amount := AmountRounding.RoundAmount(ScheduleLine.Amount);
                Preview.Insert(true);
            until ScheduleLine.Next() = 0;
    end;
}
