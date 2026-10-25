page 50205 "UI Sample Repeater"
{
    PageType = List;
    SourceTable = "Sales Line";

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field(Description; Rec.Description)
                {
                    ApplicationArea = All;
                    ShowCaption = false;
                }
                field(Amount; Rec.Amount)
                {
                    ApplicationArea = All;
                    ShowCaption = false;
                }
            }
        }
    }
}
