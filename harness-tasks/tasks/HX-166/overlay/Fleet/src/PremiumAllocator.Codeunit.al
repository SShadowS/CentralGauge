codeunit 70185 "CGR Premium Allocator"
{
    procedure AllocatePremium(PremiumNo: Code[20])
    var
        Premium: Record "CGR Insurance Premium";
        Share: Record "CGR Premium Share";
        TotalValue: Decimal;
        Allocated: Decimal;
        LinesLeft: Integer;
    begin
        Premium.Get(PremiumNo);
        Share.SetRange("Premium No.", PremiumNo);
        Share.CalcSums("Insured Value");
        TotalValue := Share."Insured Value";
        if TotalValue = 0 then
            exit;

        LinesLeft := Share.Count();
        Share.FindSet(true);
        repeat
            LinesLeft -= 1;
            if LinesLeft = 0 then
                Share."Share Amount" := Premium."Total Amount" - Allocated
            else
                Share."Share Amount" := Round(Premium."Total Amount" * Share."Insured Value" / TotalValue, 0.01);
            Allocated += Share."Share Amount";
            Share.Modify();
        until Share.Next() = 0;

        Premium.Allocated := true;
        Premium.Modify();
    end;

    procedure PremiumSharedTotal(PremiumNo: Code[20]): Decimal
    var
        Share: Record "CGR Premium Share";
    begin
        Share.SetRange("Premium No.", PremiumNo);
        Share.CalcSums("Share Amount");
        exit(Share."Share Amount");
    end;
}
