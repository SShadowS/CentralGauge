page 50212 "UI Sample Semantic Style Bad"
{
    PageType = Card;
    SourceTable = Customer;

    layout
    {
        area(Content)
        {
            field(CompanyName; Rec.Name)
            {
                ApplicationArea = All;
                Style = Favorable;
            }
            field(Confidence; ConfidencePercent)
            {
                ApplicationArea = All;
                Caption = 'Confidence';
                StyleExpr = ConfidenceStyle;
            }
        }
    }

    var
        ConfidencePercent: Decimal;
        ConfidenceStyle: Text;
}
