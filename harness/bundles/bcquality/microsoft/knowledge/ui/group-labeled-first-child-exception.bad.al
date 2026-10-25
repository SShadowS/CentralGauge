page 50204 "UI Sample First Child Bad"
{
    PageType = Card;
    SourceTable = Customer;

    layout
    {
        area(Content)
        {
            group(SomeGroup)
            {
                ShowCaption = false;
                field(DescriptionField; Rec.Address)
                {
                    ApplicationArea = All;
                    ShowCaption = false;
                    MultiLine = true;
                }
            }
        }
    }
}
