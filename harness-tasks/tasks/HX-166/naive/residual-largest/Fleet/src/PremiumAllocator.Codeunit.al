codeunit 70185 "CGR Premium Allocator"
{
    procedure AllocatePremium(PremiumNo: Code[20])
    var
        Premium: Record "CGR Insurance Premium";
        Share: Record "CGR Premium Share";
        TotalValue: Decimal;
        Handed: Decimal;
        LargestValue: Decimal;
        LargestLine: Integer;
    begin
        Premium.Get(PremiumNo);
        Share.SetRange("Premium No.", PremiumNo);
        Share.CalcSums("Insured Value");
        TotalValue := Share."Insured Value";
        if TotalValue = 0 then
            exit;

        Share.SetCurrentKey("Premium No.", "Vehicle No.");
        Share.FindSet(true);
        repeat
            Share."Share Amount" := Round(Premium."Total Amount" * Share."Insured Value" / TotalValue, 0.01);
            Handed += Share."Share Amount";
            Share.Modify();
            if Share."Insured Value" > LargestValue then begin
                LargestValue := Share."Insured Value";
                LargestLine := Share."Line No.";
            end;
        until Share.Next() = 0;

        Share.Get(PremiumNo, LargestLine);
        Share."Share Amount" += Premium."Total Amount" - Handed;
        Share.Modify();

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
