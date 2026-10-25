page 50203 "UI Sample First Child Good"
{
    PageType = Card;
    SourceTable = Customer;

    layout
    {
        area(Content)
        {
            group(Description)
            {
                Caption = 'Description';
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
