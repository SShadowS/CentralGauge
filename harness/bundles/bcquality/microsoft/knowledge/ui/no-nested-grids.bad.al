page 50210 "UI Sample Nested Grid Bad"
{
    PageType = Card;
    SourceTable = Customer;

    layout
    {
        area(Content)
        {
            grid(OuterGrid)
            {
                GridLayout = Columns;
                group(Left)
                {
                    ShowCaption = false;
                    grid(InnerGrid)
                    {
                        GridLayout = Rows;
                        group(Row1)
                        {
                            ShowCaption = false;
                            field(Name; Rec.Name)
                            {
                                ApplicationArea = All;
                                ShowCaption = false;
                            }
                        }
                    }
                }
            }
        }
    }
}
