page 50211 "UI Sample Semantic Style Good"
{
    PageType = Card;
    SourceTable = "Cust. Ledger Entry";

    layout
    {
        area(Content)
        {
            field(OverdueAmount; Rec."Remaining Amount")
            {
                ApplicationArea = All;
                Caption = 'Overdue Amount';
                Style = Unfavorable;
            }
            field(ProfitMargin; Rec.Amount)
            {
                ApplicationArea = All;
                Caption = 'Profit Margin';
                Style = Favorable;
                StyleExpr = IsProfitable;
            }
        }
    }

    var
        IsProfitable: Boolean;
}
