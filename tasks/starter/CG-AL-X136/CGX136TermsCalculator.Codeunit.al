codeunit 70961 "CG X136 Terms Calculator"
{
    procedure CalcDueDate(TermsCode: Code[10]; DocumentDate: Date): Date
    var
        Terms: Record "CG X136 Payment Terms";
    begin
        Terms.Get(TermsCode);
        exit(CalcDate(Terms."Due Date Calculation", DocumentDate));
    end;

    procedure QualifiesForDiscount(TermsCode: Code[10]; DocumentDate: Date; PaymentDate: Date): Boolean
    var
        Terms: Record "CG X136 Payment Terms";
        DiscountDate: Date;
    begin
        Terms.Get(TermsCode);
        DiscountDate := CalcDate(Terms."Discount Date Calculation", DocumentDate);
        exit(PaymentDate < DiscountDate);
    end;
}
