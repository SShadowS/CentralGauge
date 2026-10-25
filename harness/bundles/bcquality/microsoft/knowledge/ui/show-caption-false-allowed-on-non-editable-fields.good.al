page 50202 "UI Sample NonEditable Caption"
{
    PageType = Card;
    SourceTable = Customer;

    layout
    {
        area(Content)
        {
            field("Customer Name"; Rec.Name)
            {
                ApplicationArea = All;
                Editable = false;
                ShowCaption = false;
            }
        }
    }
}
