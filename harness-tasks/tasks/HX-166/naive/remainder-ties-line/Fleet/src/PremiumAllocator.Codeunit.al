codeunit 70185 "CGR Premium Allocator"
{
    procedure AllocatePremium(PremiumNo: Code[20])
    var
        Premium: Record "CGR Insurance Premium";
        Share: Record "CGR Premium Share";
        Lost: Dictionary of [Integer, Decimal];
        TotalValue: Decimal;
        Exact: Decimal;
        Handed: Decimal;
        Best: Decimal;
        BestLine: Integer;
    begin
        Premium.Get(PremiumNo);
        Share.SetRange("Premium No.", PremiumNo);
        Share.CalcSums("Insured Value");
        TotalValue := Share."Insured Value";
        if TotalValue = 0 then
            exit;

        Share.FindSet(true);
        repeat
            Exact := Premium."Total Amount" * Share."Insured Value" / TotalValue;
            Share."Share Amount" := Round(Exact, 0.01, '<');
            Handed += Share."Share Amount";
            Lost.Add(Share."Line No.", Exact - Share."Share Amount");
            Share.Modify();
        until Share.Next() = 0;

        while Handed < Premium."Total Amount" do begin
            Best := -1;
            Share.FindSet();
            repeat
                if Lost.Get(Share."Line No.") > Best then begin
                    Best := Lost.Get(Share."Line No.");
                    BestLine := Share."Line No.";
                end;
            until Share.Next() = 0;
            Share.Get(PremiumNo, BestLine);
            Share."Share Amount" += 0.01;
            Share.Modify();
            Lost.Set(BestLine, -1);
            Handed += 0.01;
        end;

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
